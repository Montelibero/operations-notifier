const config = require('../models/config'),
    stellarConnector = require('./stellar-connector'),
    {horizonPool} = stellarConnector,
    {parseTransaction} = require('./stream-processor'),
    sorobanRpc = require('./soroban-rpc-client'),
    liquidityPools = require('./liquidity-pools'),
    {decodeMeta} = require('../util/soroban-helper'),
    storage = require('./storage'),
    logger = require('../util/logger'),
    {sanitizeUrlForLogs} = require('../util/log-redaction')

const transactionsBatchSize = 200

function getNumericConfigValue(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    const parsed = parseInt(value)
    return isNaN(parsed) ? fallback : parsed
}

function fetchTransactions(cursor, ledgerSequence = undefined, watcher = null) {
    const params = new URLSearchParams({order: 'asc', limit: String(transactionsBatchSize)})

    if (cursor !== undefined && cursor !== null) {
        try {
            // Ensure cursor is a valid string and attempt to parse as BigInt to validate
            const cursorStr = String(cursor).trim()
            if (cursorStr && cursorStr !== 'undefined' && cursorStr !== 'null') {
                // Validate by parsing as BigInt
                BigInt(cursorStr)
                params.set('cursor', cursorStr)
            } else {
                cursor = undefined
            }
        } catch (err) {
            cursor = undefined
            console.error(`Error with cursor, using default: ${err.message}`)
        }
    }

    // per-ledger fetches use the ledger sub-resource: `/transactions?ledger=` is NOT a valid filter
    // (Horizon silently ignores it and returns the whole transaction history from the beginning)
    const resource = ledgerSequence !== undefined ? `/ledgers/${ledgerSequence}/transactions` : '/transactions'
    const path = `${resource}?${params.toString()}`
    const start = Date.now()

    return horizonPool.call({path, ledger: ledgerSequence})
        .then(result => {
            const records = result.records || []
            const recordCount = records.length
            if (recordCount > 50 || start === 0) {
                if (ledgerSequence) {
                    logger.info(`Fetched ${recordCount} txs from ledger ${ledgerSequence}`)
                } else if (cursor && recordCount === transactionsBatchSize && watcher) {
                    const lastTx = records[recordCount - 1]
                    const ledger = lastTx.ledger ?? '?'
                    // Update lastLedgerSeen if we see a newer ledger
                    if (typeof lastTx.ledger === 'number' && lastTx.ledger > (watcher.lastLedgerSeen || 0)) {
                        watcher.lastLedgerSeen = lastTx.ledger
                    }
                    const lag = (typeof watcher.lastLedgerSeen === 'number' && typeof lastTx.ledger === 'number')
                        ? watcher.lastLedgerSeen - lastTx.ledger
                        : '?'
                    const queue = watcher.queue ? watcher.queue.length : 0
                    logger.info(`Fetched ${recordCount} txs (ledger ${ledger}, lag ${lag}, queue ${queue})`)
                } else if (cursor) {
                    logger.info(`Fetched ${recordCount} txs`)
                }
            }
            return {...result, records}
        })
        .catch(err => {
            console.error(`Fetch error: ${err.message}`)
            throw err
        })
}

/**
 * Tracks transactions using event streaming from Horizon server
 */
class TransactionWatcher {
    constructor(observer) {
        this.queue = []
        this.ledgerQueue = []
        this.ledgerInProgress = 0
        this.maxLedgerWorkers = Math.max(1, parseInt(config.ledgerWorkers || 10))
        this.txInProgress = 0
        this.maxTxWorkers = Math.max(1, parseInt(config.transactionWorkers || 10))
        this.observer = observer
        this.lastLedger = null
        this.lastLedgerSeen = null
        this.lastLedgerProcessed = null
        this.lastTxPagingToken = null
        this.lastTxHash = null
        this.highestProcessedPagingToken = null
        this.lastLagLogAt = 0
        this.streaming = false
        this.state = 'idle'
        this.startedAt = new Date()
        this.lastSuccessfulFetchAt = null
        this.lastLedgerSeenAt = null
        this.lastLedgerProcessedAt = null
        this.lastRecoveryAttemptAt = null
        this.lastErrorAt = null
        this.lastErrorMessage = null
        this.recoveryTimer = null
        this.streamUrl = null
        this.lastStreamStartAt = 0
        this.streamRestartTimer = null
        this.streamGraceMs = 15000
        this.stallTimer = null
        this.stallCheckInProgress = false
        this.lastSlowNetworkLogAt = 0
        this.onPoolSwitchHandler = event => this.onPoolSwitch(event)
    }

    markFetchSuccess() {
        this.lastSuccessfulFetchAt = new Date()
        this.lastErrorAt = null
        this.lastErrorMessage = null
    }

    markLedgerSeen() {
        this.lastLedgerSeenAt = new Date()
    }

    markLedgerProcessed() {
        this.lastLedgerProcessedAt = new Date()
        this.markFetchSuccess()
    }

    getBackoffDelay(defaultDelay = 1000) {
        if (this.reconnectDelay) {
            this.reconnectDelay *= 2
        } else {
            this.reconnectDelay = defaultDelay
        }
        if (this.reconnectDelay > 60000) {
            this.reconnectDelay = 60000
        }
        return this.reconnectDelay
    }

    scheduleRecovery(reason, delay) {
        if (!this.observer.observing) return
        const recoveryDelay = Math.min(Math.max(parseInt(delay) || 1000, 1000), 60000)
        this.lastErrorAt = new Date()
        this.lastErrorMessage = reason || 'unknown error'
        this.lastRecoveryAttemptAt = new Date()
        this.state = 'recovering'
        this.stopWatching(true)
        if (this.recoveryTimer) {
            clearTimeout(this.recoveryTimer)
        }
        logger.warn(`Watcher recovery scheduled (${this.lastErrorMessage}). Restarting in ${recoveryDelay / 1000}s...`)
        this.recoveryTimer = setTimeout(() => {
            this.recoveryTimer = null
            if (!this.observer.observing) return
            this.watch()
        }, recoveryDelay)
    }

    getAgeSeconds(date) {
        if (!date) return null
        return Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    }

    /**
     * Add transactions to the processing queue
     * @param {Array<Transaction>}transactions
     */
    enqueue(transactions) {
        if (!transactions || !transactions.length) return
        Array.prototype.push.apply(this.queue, transactions)
        // Spawn multiple workers
        const workersToStart = Math.min(this.maxTxWorkers, transactions.length)
        for (let i = 0; i < workersToStart; i++) {
            setTimeout(() => this.processQueue(), 0)
        }
    }

    enqueueLedger(sequence) {
        if (!sequence) return
        this.ledgerQueue.push(sequence)
        this.processLedgerQueue()
    }

    processLedgerQueue() {
        if (!this.streaming) return
        while (this.ledgerInProgress < this.maxLedgerWorkers && this.ledgerQueue.length) {
            const sequence = this.ledgerQueue.shift()
            this.ledgerInProgress++
            this.loadLedgerTransactions(sequence)
                .catch(err => console.error(err))
                .finally(() => {
                    this.ledgerInProgress--
                    setTimeout(() => this.processLedgerQueue(), 0)
                })
        }
    }

    /**
     * Pick entries from the queue and process them with worker pool
     */
    processQueue() {
        if (!this.observer.subscriptions || !this.observer.observing) return

        // Spawn workers up to the limit
        while (this.txInProgress < this.maxTxWorkers && this.queue.length > 0) {
            const rawTx = this.queue.shift() // FIFO order
            if (!rawTx) break

            this.txInProgress++
            this.processTransaction(rawTx)
                .catch(err => console.error('Transaction processing error:', err))
                .finally(() => {
                    this.txInProgress--
                    setTimeout(() => this.processQueue(), 0)
                })
        }
    }

    /**
     * Process a single transaction
     * @param {Object} rawTx - Raw transaction from Horizon
     * @returns {Promise}
     */
    async processTransaction(rawTx) {
        const tx = parseTransaction(rawTx)

        if (!tx) { // Failed to parse transaction (unknown XDR or malformed envelope): count it, never fail silently
            this.skippedTransactions = (this.skippedTransactions || 0) + 1
            this.lastSkipped = {
                hash: rawTx && rawTx.hash,
                ledger: rawTx && rawTx.ledger,
                at: new Date().toISOString()
            }
            return
        }

        // attach liquidity pool asset pairs (cached, one Horizon lookup per unknown pool) before matching
        try {
            await liquidityPools.enrichTransaction(tx)
        } catch (e) {
            logger.warn(`Liquidity pool enrichment failed for ${tx.details.hash}: ${e.message}`)
        }
        await this._processParsedTransaction(tx)
    }

    /**
     * Match the operations of an already parsed and enriched transaction and queue the notifications.
     * Never rejects: a failure here must not stop the processing of other transactions.
     * @param {Object} tx - parsed transaction
     */
    async _processParsedTransaction(tx) {
        const notifications = [],
            relevantSubscriptions = new Set()
        const txLedger = tx.details.ledger
        if (typeof this.lastLedgerSeen === 'number' && typeof txLedger === 'number') {
            const lag = this.lastLedgerSeen - txLedger
            if (lag > 20) {
                const now = Date.now()
                if (!this.lastLagLogAt || now - this.lastLagLogAt > 5000) {
                    logger.info(`Lagging by ${lag} ledgers (tx ledger ${txLedger}, latest ${this.lastLedgerSeen}).`)
                    this.lastLagLogAt = now
                }
            }
        }

        for (const operation of tx.operations) {
            // Create a notification
            let notification = {
                payload: operation,
                subscriptions: []
            }
            // Use index for O(1) candidate lookup instead of O(N) linear scan
            const matchedSubscriptions = this.observer.subscriptionIndex.findMatches(operation)
            for (const subscription of matchedSubscriptions) {
                // Associate a subscription with current notification
                notification.subscriptions.push(subscription.id)
                // Will use it once notifications are persisted
                relevantSubscriptions.add(subscription)
                // Mark subscription as ready to be processed
                subscription.processed = false
            }

            // Process a notification if at least one match was found
            if (notification.subscriptions.length) {
                notifications.push(notification)
            }
        }

        try {
            // Soroban meta enrichment: fetch resultMetaXdr via Soroban RPC only when
            // at least one invoke_host_function op has a matching subscription, then
            // decode events and return_value and attach them to the operation payload.
            await this._enrichSorobanOps(tx, notifications)
            const savedNotifications = (await this.observer.notifier.createNotifications(notifications)) || notifications

            if (this.processTxCount === undefined) this.processTxCount = 0
            this.processTxCount++
            if (this.processTxCount % 20 === 0) {
                logger.debug(`Processed ${this.processTxCount} transactions, latest token: ${tx.details.paging_token.substring(0, 8)}...`)
            }

            // Thread-safe update of highest paging token
            this.updateHighestPagingToken(tx.details.paging_token)

            // Iterate through processed subscriptions
            for (let subscription of relevantSubscriptions) {
                // Cache notifications directly inside the subscription
                if (!subscription.notifications) {
                    subscription.notifications = new Set()
                }
                for (let notification of savedNotifications) {
                    if (notification.subscriptions.some(s => s == subscription.id)) {
                        subscription.notifications.add(notification)
                    }
                }
            }

            this.observer.notifier.startNewNotifierThread()
        } catch (err) {
            console.error(err)
            // Don't reject, continue processing other transactions
        }
    }

    /**
     * For each notification whose payload is an invoke_host_function matching
     * a subscription, fetch transaction meta via Soroban RPC and attach
     * decoded events + return_value to the operation payload.
     *
     * No-op if Soroban RPC is not configured.
     * @param {Object} tx - parsed tx returned by parseTransaction()
     * @param {Array} notifications - notifications to be sent
     */
    async _enrichSorobanOps(tx, notifications) {
        if (!sorobanRpc.client || !notifications.length) return
        const sorobanNotifications = notifications.filter(n => n.payload && n.payload.type_i === 24)
        if (!sorobanNotifications.length) return
        const txHash = tx.details.hash
        try {
            const result = await sorobanRpc.client.getTransaction(txHash)
            if (!result || !result.resultMetaXdr) return
            for (const n of sorobanNotifications) {
                const opIndex = typeof n.payload.application_order === 'number' ? n.payload.application_order : 0
                const {events, return_value} = decodeMeta(result.resultMetaXdr, opIndex)
                n.payload.events = events
                n.payload.return_value = return_value
            }
        } catch (err) {
            logger.warn(`Soroban meta enrichment failed for tx ${txHash}: ${err.message}`)
        }
    }

    /**
     * Thread-safe update of highest processed paging token
     * @param {string} pagingToken - Paging token from processed transaction
     */
    updateHighestPagingToken(pagingToken) {
        // Добавляем принудительное обновление, если прошло много времени
        const now = Date.now();
        if (!this.lastForcedCursorUpdate || (now - this.lastForcedCursorUpdate > 60000)) {
            // Раз в минуту принудительно обновляем курсор, даже если он не изменился
            this.lastForcedCursorUpdate = now;
                                    logger.debug(`Forced cursor update to ${pagingToken.substring(0, 8)}...`);
            
            this.highestProcessedPagingToken = pagingToken;
            this.cursor = pagingToken;
            storage.updateLastIngestedTx(pagingToken)
                .catch(err => console.error('Failed to update last ingested tx:', err));
            return;
        }
        
        try {
            const current = BigInt(this.highestProcessedPagingToken || '0');
            const incoming = BigInt(pagingToken || '0');
            
            if (incoming > current) {
                // Только если входящий токен больше текущего, без лога
                this.highestProcessedPagingToken = pagingToken;
                this.cursor = pagingToken; // Set cursor directly to ensure it's updated
                storage.updateLastIngestedTx(pagingToken)
                    .catch(err => console.error('Failed to update last ingested tx:', err));
            }
        } catch (err) {
            console.error(`[DEBUG] Error updating token: ${err.message}`);
        }
    }

    /**
     * Start watching
     */
    watch() {
        if (this.recoveryTimer) {
            clearTimeout(this.recoveryTimer)
            this.recoveryTimer = null
        }
        if (this.releaseStream) return
        if (!this.poolSwitchSubscribed) {
            // follow the active server; re-subscribed on the next watch() after a full stop
            horizonPool.on('switch', this.onPoolSwitchHandler)
            this.poolSwitchSubscribed = true
        }
        this.state = 'starting'
        if (!this.startedAt) {
            this.startedAt = new Date()
        }

        // Fetch current ledger for lag calculation during catch-up
        stellarConnector.fetchLatestLedger()
            .then(sequence => {
                if (sequence) {
                    this.lastLedgerSeen = sequence
                    logger.info(`Current network ledger: ${sequence}`)
                }
            })
            .catch(() => {}) // non-critical

        // Check if cursor reset is requested
        if (config.resetCursor) {
            logger.info('RESET_CURSOR is set, ignoring saved cursor and starting live stream')
            this.cursor = null
            this.trackTransactions()
            return
        }

        storage.getLastIngestedTx()
            .then(cursor => {
                console.log(`Starting watch with initial cursor: ${cursor}`)
                // Ensure we have a valid cursor or force starting from a live stream
                if (!cursor || cursor === 'undefined' || cursor === 'null') {
                    logger.info('Invalid or missing cursor, starting live stream')
                    this.cursor = null
                } else {
                    this.cursor = cursor
                }
                this.trackTransactions()
            })
            .catch(err => {
                console.error(`Error starting watch: ${err.message}`)
                // Fall back to live stream on error
                this.cursor = null
                this.trackLiveStream()
            })
    }

    /**
     * Fast-forward transaction tracking from the last known tx
     */
    trackTransactions() {
        if (!this.observer.observing) return // redundant check
        if (!this.cursor || this.cursor === '0') {
                logger.info("No cursor available, switching to live stream")
            return this.trackLiveStream()
        }

        logger.debug(`trackTransactions with cursor: ${this.cursor.substring(0, 8)}...`)
        this.state = 'catching_up'
        
        // Используем highestProcessedPagingToken если он доступен и больше текущего курсора
        if (this.highestProcessedPagingToken) {
            try {
                const currentCursor = BigInt(this.cursor || '0')
                const highestToken = BigInt(this.highestProcessedPagingToken || '0')
                
                if (highestToken > currentCursor) {
                    logger.debug(`Using highest token instead of cursor`)
                    this.cursor = this.highestProcessedPagingToken
                }
            } catch (err) {
                logger.debug(`Error comparing cursors: ${err.message}`)
            }
        }
        
        // Добавим счетчик вызовов для отслеживания цикличности
        this.fetchCount = (this.fetchCount || 0) + 1
        if (this.fetchCount % 10 === 0) {
                logger.debug(`Fetch count: ${this.fetchCount}, still using cursor: ${this.cursor.substring(0, 8)}...`)
        }
        
        fetchTransactions(this.cursor, undefined, this)
            .then(({records}) => {
                this.markFetchSuccess()
                if (!records || !records.length) {
                    logger.debug('No records found, switching to live stream')
                    this.trackLiveStream()
                } else {
                    const lastTx = records[records.length - 1]
                    
                    logger.debug(`Processed batch, last tx hash: ${lastTx.hash.substring(0, 8)}..., paging: ${lastTx.paging_token.substring(0, 8)}...`)
                    
                    try {
                        // Проверяем, что новый токен больше текущего
                        const lastPagingToken = BigInt(lastTx.paging_token)
                        const currentCursor = BigInt(this.cursor || '0')
                        
                        if (lastPagingToken > currentCursor) {
                            const prevCursor = this.cursor
                            this.lastTxPagingToken = lastTx.paging_token
                            this.lastTxHash = lastTx.hash
                            this.lastLedger = lastTx.ledger
                            
                            // Обновляем курсор только если новый токен больше текущего
                            this.cursor = lastTx.paging_token
                            
                            logger.debug(`Cursor updated: ${prevCursor.substring(0, 8)}... -> ${this.cursor.substring(0, 8)}...`)
                        } else {
                            logger.debug(`Cursor NOT updated: last token (${lastPagingToken}) <= current (${currentCursor})`)
                            
                            // Если мы сделали много запросов и курсор не меняется, возможно, мы застряли
                            if (this.fetchCount > 50) {
                                logger.debug('Too many fetches without cursor change, forcing live stream')
                                this.cursor = null
                                this.trackLiveStream()
                                return
                            }
                        }
                    } catch (err) {
                        console.error(`[DEBUG] Error comparing paging tokens: ${err.message}`)
                    }
                    
                    // Обрабатываем транзакции в любом случае
                    this.enqueue(records)
                    
                    // Планируем следующую порцию
                    setTimeout(() => this.trackTransactions(), 0)
                }
            })
            .catch(err => {
                // the pool has already failed over across all servers and retried; schedule a recovery
                console.error(`Error in trackTransactions: ${err.message}`)
                // A rejected cursor (Horizon answers 400 with a problem+json detail mentioning it) is the only
                // reason to drop the catch-up cursor; temporary failures (5xx, timeouts, all servers down)
                // must keep the cursor and go through the regular recovery.
                const problem = `${err.title || ''} ${err.detail || ''}`
                if (err.type === 'fatal' && /cursor|paging|token|invalid|not found/i.test(problem)) {
                    logger.warn(`Cursor rejected by Horizon (${problem.trim()}), switching to live stream`)
                    this.cursor = null
                    this.trackLiveStream()
                    return
                }
                this.scheduleRecovery(err.message || 'trackTransactions failed', this.getBackoffDelay(1000))
            })
            
        // Защита от зацикливания - если мы долго в транзакционном режиме
        if (!this.lastStreamCheck) this.lastStreamCheck = Date.now()
        const timeSinceLastCheck = Date.now() - this.lastStreamCheck
        
        // Раз в 5 минут проверяем, не пора ли перейти в режим стриминга
        if (timeSinceLastCheck > 300000) {
            this.lastStreamCheck = Date.now()
            logger.debug('Periodic stream check, trying to switch to live mode')
            
            // Запускаем стрим параллельно с обработкой транзакций
            this.cursor = null
            this.trackLiveStream()
        }
    }

    /**
     * Track live transactions stream from the Horizon server
     */
    trackLiveStream(force = false) {
        if (!force && this.streaming && this.releaseStream) {
            logger.info('Already streaming ledgers, skipping restart')
            return
        }

        this.stopStream()

        this.streaming = true
        this.state = 'streaming'
        const url = horizonPool.activeUrl || horizonPool.fallbackUrl
        this.streamUrl = url
        this.lastStreamStartAt = Date.now()
        logger.info(`Starting ledger stream from ${sanitizeUrlForLogs(url)}...`)
        this.releaseStream = stellarConnector.getHorizonServer(url)
            .ledgers()
            .order('asc')
            .cursor('now')
            .stream({
                onmessage: rawLedger => {
                    this.reconnectDelay = undefined
                    this.lastLedger = rawLedger.sequence
                    this.lastLedgerSeen = rawLedger.sequence
                    this.markFetchSuccess()
                    this.markLedgerSeen()
                    logger.info(`Ledger received: ${rawLedger.sequence}`)
                    this.enqueueLedger(rawLedger.sequence)
                },
                onerror: err => {
                    const status = err && (err.status || (err.response && err.response.status))
                    const detail = status ? `status ${status}` : (err && err.message ? err.message : 'unknown error')
                    // let the pool know the streaming server misbehaves, so the reconnect goes to the next one
                    const failure = {message: detail}
                    if (status === 429 || /429/.test(detail)) failure.type = 'rate_limited'
                    else if (/non-200|status 5\d\d|ECONN|ETIMEDOUT|timeout|fetch failed/i.test(detail)) failure.type = 'retry'
                    if (failure.type) horizonPool.reportStreamFailure(url, failure)
                    this.reconnectDelay = this.getBackoffDelay(1000)
                    logger.warn(`Ledger stream error from ${sanitizeUrlForLogs(url)} (${detail}). Reconnecting in ${this.reconnectDelay / 1000}s...`)
                    this.scheduleRecovery(`stream ${detail}`, this.reconnectDelay)
                }
            })
        this.startStallCheck()
    }

    stopStream() {
        if (this.releaseStream) {
            this.releaseStream()
            this.releaseStream = null
        }
        this.stopStallCheck()
        if (this.streamRestartTimer) {
            clearTimeout(this.streamRestartTimer)
            this.streamRestartTimer = null
        }
    }

    /**
     * The pool switched the active server — move the ledger stream there (with a grace period against flapping).
     * @param {{from: string, to: string, reason: string}} event
     */
    onPoolSwitch(event) {
        if (!this.streaming) return // REST requests follow the pool automatically
        const elapsed = Date.now() - (this.lastStreamStartAt || 0)
        const delay = Math.max(0, this.streamGraceMs - elapsed)
        if (this.streamRestartTimer) return
        this.streamRestartTimer = setTimeout(() => {
            this.streamRestartTimer = null
            if (!this.streaming) return
            logger.info(`Active Horizon server changed (${event.reason}), restarting the ledger stream on ${sanitizeUrlForLogs(event.to || horizonPool.fallbackUrl)}`)
            this.trackLiveStream(true)
        }, delay)
        if (this.streamRestartTimer.unref) this.streamRestartTimer.unref()
    }

    startStallCheck() {
        this.stopStallCheck()
        this.stallTimer = setInterval(() => this.checkStreamStall(), 5000)
        if (this.stallTimer.unref) this.stallTimer.unref()
    }

    stopStallCheck() {
        if (this.stallTimer) {
            clearInterval(this.stallTimer)
            this.stallTimer = null
        }
    }

    /**
     * If the ledger stream is silent for longer than `horizonStallSeconds` (counted from the last ledger or,
     * on a cold start, from the stream start), ask the streaming server for its latest ledger via REST and
     * compare with a peer server:
     * - the server is behind the peer by 2+ ledgers → it stopped ingesting: mark it down and switch;
     * - the server does not answer REST either → it is down: mark it down and switch;
     * - the server ingested ledgers that the stream never delivered → the SSE connection is stuck: restart it;
     * - nothing new anywhere → the network is slow: log it (throttled).
     */
    async checkStreamStall() {
        if (!this.streaming || !this.streamUrl) return
        const lastActivityAt = this.lastLedgerSeenAt || this.lastStreamStartAt
        if (!lastActivityAt) return
        const stallMs = Date.now() - new Date(lastActivityAt).getTime()
        if (stallMs < (config.horizonStallSeconds || 20) * 1000 || this.stallCheckInProgress) return
        const stalledUrl = this.streamUrl
        this.stallCheckInProgress = true
        try {
            const [peer, own] = await Promise.all([
                stellarConnector.fetchPeerLatestLedger(stalledUrl),
                stellarConnector.fetchLatestLedger(stalledUrl).catch(() => null)
            ])
            if (!this.streaming || this.streamUrl !== stalledUrl) return
            // `own === null` means the server does not answer REST either — handled below regardless of peers
            const seen = this.lastLedgerSeen || 0
            const stalled = horizonPool.servers.find(server => server.url === stalledUrl)
            const stalledFor = `${Math.round(stallMs / 1000)}s`
            if (own === null) {
                logger.warn(`Ledger stream from ${sanitizeUrlForLogs(stalledUrl)} stalled for ${stalledFor} and the server does not answer REST — switching`)
                if (stalled) horizonPool.markDown(stalled, `stalled stream, REST timeout`) // emits switch → onPoolSwitch
            } else if (peer && peer.ledger >= own + 2) {
                logger.warn(`Ledger stream from ${sanitizeUrlForLogs(stalledUrl)} stalled for ${stalledFor}: ${sanitizeUrlForLogs(peer.url)} is at ledger ${peer.ledger} vs ${own} — switching`)
                if (stalled) horizonPool.markBehind(stalled, own, peer.ledger) // emits switch → onPoolSwitch
            } else if (own > seen) {
                logger.warn(`Ledger stream from ${sanitizeUrlForLogs(stalledUrl)} stalled for ${stalledFor} while the server is at ledger ${own} (stream last saw ${seen}) — restarting the stream`)
                this.trackLiveStream(true)
            } else {
                // nothing new on the streaming server either: the whole network is slow, say it once a minute at most
                if (!this.lastSlowNetworkLogAt || Date.now() - this.lastSlowNetworkLogAt > 60000) {
                    this.lastSlowNetworkLogAt = Date.now()
                    logger.info(`Ledger stream from ${sanitizeUrlForLogs(stalledUrl)} silent for ${stalledFor}, the server itself is at ledger ${own} — network is slow, not switching`)
                }
            }
        } finally {
            this.stallCheckInProgress = false
        }
    }

    loadLedgerTransactions(sequence, txCursor) {
        return new Promise((resolve, reject) => {
            let notFoundRetries = 0
            let poolRetries = 0
            const fetchLedgerTxBatch = (cursor) => {
                fetchTransactions(cursor, sequence)
                    .then(({records}) => {
                        this.markFetchSuccess()
                        const txCount = records?.length || 0
                        if (!records || !records.length) {
                            this.lastLedgerProcessed = sequence
                            this.markLedgerProcessed()
                            if (sequence % 10 === 0) {
                                logger.info(`Ledger ${sequence} processed (0 transactions)`)
                            }
                            return resolve()
                        }
                        this.enqueue(records)
                        const fetchedCount = records.length
                        const lastTx = records[fetchedCount - 1]
                        this.lastTxPagingToken = lastTx.paging_token
                        this.lastTxHash = lastTx.hash
                        this.lastLedgerProcessed = lastTx.ledger
                        this.markLedgerProcessed()
                        
                        // Принудительно обновляем курсор при обработке леджера
                        this.highestProcessedPagingToken = lastTx.paging_token
                        this.cursor = lastTx.paging_token
                        logger.debug(`Ledger processing updated cursor to ${this.cursor.substring(0, 8)}...`)
                        
                        // Сохраняем в базу
                        storage.updateLastIngestedTx(lastTx.paging_token)
                            .catch(err => console.error(`Failed to update ledger cursor: ${err.message}`))
                        
                        if (this.lastLedgerSeen === null && typeof lastTx.ledger === 'number') {
                            this.lastLedgerSeen = lastTx.ledger
                            this.lastLedger = lastTx.ledger
                        }
                        if (fetchedCount < transactionsBatchSize) {
                            logger.info(`Ledger ${sequence} processed (${txCount} transactions)`)
                            return resolve()
                        }
                        fetchLedgerTxBatch(lastTx.paging_token)
                    })
                    .catch(e => {
                        // the pool already failed over and exhausted its same-server retries
                        const status = e && e.status
                        if ((status === 404 || status === 502 || status === 503 || status === 504) && notFoundRetries < 5) {
                            // a 404 here means no server has ingested the ledger yet
                            notFoundRetries++
                            return setTimeout(() => fetchLedgerTxBatch(cursor), 1000)
                        }
                        // every server is down or rate limited: wait and retry rather than drop the ledger
                        if ((e.type === 'retry' || e.type === 'rate_limited') && poolRetries < 10) {
                            poolRetries++
                            const resetIn = e.type === 'rate_limited' && e.resetAt ? e.resetAt - Date.now() : 0
                            const delay = Math.min(60000, Math.max(1000, resetIn, poolRetries * 2000))
                            logger.warn(`Ledger ${sequence}: Horizon pool unavailable (${e.message}), retrying in ${Math.round(delay / 1000)}s`)
                            return setTimeout(() => fetchLedgerTxBatch(cursor), delay)
                        }
                        reject(e)
                    })
            }
            fetchLedgerTxBatch(txCursor)
        })
    }

    /**
     * Terminates watching stream
     */
    stopWatching() {
        this.streaming = false
        this.state = this.observer.observing ? 'stopped' : 'idle'
        this.stopStream()
        if (arguments[0] !== true) {
            // full stop (not a recovery restart): stop following the pool as well
            if (this.poolSwitchSubscribed) {
                horizonPool.off('switch', this.onPoolSwitchHandler)
                this.poolSwitchSubscribed = false
            }
            if (this.recoveryTimer) {
                clearTimeout(this.recoveryTimer)
                this.recoveryTimer = null
            }
        }
    }

    getHealth() {
        const startupGraceSeconds = getNumericConfigValue(config.healthStartupGraceSeconds, 120)
        const maxNoSuccessSeconds = getNumericConfigValue(config.healthMaxNoSuccessSeconds, 120)
        const maxNoLedgerSeconds = getNumericConfigValue(config.healthMaxNoLedgerSeconds, 180)
        const maxNoProgressSeconds = getNumericConfigValue(config.healthMaxNoProgressSeconds, 180)
        const uptimeSeconds = this.getAgeSeconds(this.startedAt) || 0
        const sinceSuccess = this.getAgeSeconds(this.lastSuccessfulFetchAt)
        const sinceLedgerSeen = this.getAgeSeconds(this.lastLedgerSeenAt)
        const sinceProgress = this.getAgeSeconds(this.lastLedgerProcessedAt)

        if (!this.observer.observing) {
            return {
                healthy: true,
                reason: 'observer_stopped',
                state: this.state,
                secondsSinceSuccessfulFetch: sinceSuccess,
                secondsSinceLedgerSeen: sinceLedgerSeen,
                secondsSinceLedgerProcessed: sinceProgress
            }
        }

        if (uptimeSeconds < startupGraceSeconds) {
            return {
                healthy: true,
                reason: 'startup_grace',
                state: this.state,
                secondsSinceSuccessfulFetch: sinceSuccess,
                secondsSinceLedgerSeen: sinceLedgerSeen,
                secondsSinceLedgerProcessed: sinceProgress
            }
        }

        const isCatchingUp = this.state === 'catching_up'
        const isActive = isCatchingUp || this.streaming || !!this.releaseStream || !!this.recoveryTimer
        const successStalled = sinceSuccess !== null && sinceSuccess > maxNoSuccessSeconds
        const ledgerStalled = !isCatchingUp && sinceLedgerSeen !== null && sinceLedgerSeen > maxNoLedgerSeconds
        const progressStalled = sinceProgress !== null && sinceProgress > maxNoProgressSeconds
        const noRecentSignals = successStalled || ledgerStalled || progressStalled
        const noActiveRecovery = !isActive

        return {
            healthy: !noRecentSignals && !noActiveRecovery,
            reason: (!noRecentSignals && !noActiveRecovery) ? 'ok' : 'watcher_stalled',
            state: this.state,
            lastErrorAt: this.lastErrorAt,
            lastErrorMessage: this.lastErrorMessage,
            secondsSinceSuccessfulFetch: sinceSuccess,
            secondsSinceLedgerSeen: sinceLedgerSeen,
            secondsSinceLedgerProcessed: sinceProgress
        }
    }

    /**
     * Returns current watcher status
     */
    getStatus() {
        const ledgerLag = (typeof this.lastLedgerSeen === 'number' && typeof this.lastLedgerProcessed === 'number')
            ? this.lastLedgerSeen - this.lastLedgerProcessed
            : null
        return {
            streaming: this.streaming && !!this.releaseStream,
            state: this.state,
            lastLedger: this.lastLedgerSeen ?? this.lastLedger ?? null,
            lastLedgerSeen: this.lastLedgerSeen ?? null,
            lastLedgerProcessed: this.lastLedgerProcessed ?? null,
            lastLedgerSeenAt: this.lastLedgerSeenAt,
            lastLedgerProcessedAt: this.lastLedgerProcessedAt,
            ledgerLag,
            lastTxPagingToken: this.lastTxPagingToken,
            lastTxHash: this.lastTxHash,
            queueLength: this.queue.length,
            ledgerQueueLength: this.ledgerQueue.length,
            ledgerInProgress: this.ledgerInProgress,
            ledgerWorkers: this.maxLedgerWorkers,
            txInProgress: this.txInProgress,
            txWorkers: this.maxTxWorkers,
            reconnectDelay: this.reconnectDelay,
            lastSuccessfulFetchAt: this.lastSuccessfulFetchAt,
            lastRecoveryAttemptAt: this.lastRecoveryAttemptAt,
            lastErrorAt: this.lastErrorAt,
            lastErrorMessage: this.lastErrorMessage,
            skippedTransactions: this.skippedTransactions || 0,
            lastSkippedTransaction: this.lastSkipped || null,
            horizon: horizonPool.getStatus(),
            sorobanRpc: sorobanRpc.client ? sorobanRpc.client.getStatus() : null,
            healthy: this.getHealth().healthy
        }
    }
}

module.exports = TransactionWatcher
module.exports.fetchTransactions = fetchTransactions
