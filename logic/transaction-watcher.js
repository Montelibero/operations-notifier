const config = require('../models/config'),
    {horizon} = require('./stellar-connector'),
    {parseTransaction} = require('./stream-processor'),
    {matches} = require('../util/subscription-match-helper'),
    storage = require('./storage'),
    logger = require('../util/logger')

const transactionsBatchSize = 200

/**
 * Get header value case-insensitively
 * @param {Object} headers - HTTP headers object
 * @param {string} name - Header name to find
 * @returns {string|undefined} Header value or undefined
 */
function getHeader(headers, name) {
    if (!headers) return undefined
    // Try exact match first
    if (headers[name] !== undefined) return headers[name]
    // Try lowercase (axios normalizes to lowercase)
    const lower = name.toLowerCase()
    if (headers[lower] !== undefined) return headers[lower]
    // Try uppercase
    const upper = name.toUpperCase()
    if (headers[upper] !== undefined) return headers[upper]
    // Search through all keys case-insensitively
    const lowerName = name.toLowerCase()
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lowerName) {
            return headers[key]
        }
    }
    return undefined
}

function fetchTransactions(cursor, ledgerSequence = undefined, watcher = null) {
    let builder = horizon
        .transactions()

    if (ledgerSequence !== undefined) {
        builder = builder.forLedger(ledgerSequence)
    }

    if (cursor !== undefined && cursor !== null) {
        try {
            // Ensure cursor is a valid string and attempt to parse as BigInt to validate
            const cursorStr = String(cursor).trim()
            if (cursorStr && cursorStr !== 'undefined' && cursorStr !== 'null') {
                // Validate by parsing as BigInt
                BigInt(cursorStr)
                builder = builder.cursor(cursorStr)
            } else {
                // Если курсор невалидный, не используем его
                cursor = undefined
            }
        } catch (err) {
            // Если ошибка при обработке курсора, не используем его
            console.error(`Error with cursor, using default: ${err.message}`)
            cursor = undefined
        }
    }

    builder = builder.order('asc').limit(transactionsBatchSize)
    const start = Date.now()

    return builder.call()
        .then(result => {
            const recordCount = result.records?.length || 0;
            if (recordCount > 50 || start === 0) {
                if (ledgerSequence) {
                    logger.info(`Fetched ${recordCount} txs from ledger ${ledgerSequence}`)
                } else if (cursor && recordCount === transactionsBatchSize && watcher) {
                    const lastTx = result.records[recordCount - 1]
                    const ledger = lastTx.ledger_attr || '?'
                    const lag = (typeof watcher.lastLedgerSeen === 'number' && typeof lastTx.ledger_attr === 'number')
                        ? watcher.lastLedgerSeen - lastTx.ledger_attr
                        : '?'
                    const queue = watcher.queue ? watcher.queue.length : 0
                    logger.info(`Fetched ${recordCount} txs (ledger ${ledger}, lag ${lag}, queue ${queue})`)
                } else if (cursor) {
                    logger.info(`Fetched ${recordCount} txs`)
                }
            }
            return result
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
            setImmediate(() => this.processQueue())
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
                    setImmediate(() => this.processLedgerQueue())
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
                    setImmediate(() => this.processQueue())
                })
        }
    }

    /**
     * Process a single transaction
     * @param {Object} rawTx - Raw transaction from Horizon
     * @returns {Promise}
     */
    processTransaction(rawTx) {
        return new Promise((resolve, reject) => {
            const tx = parseTransaction(rawTx),
                notifications = [],
                relevantSubscriptions = new Set()

            if (!tx) { // Failed to parse transaction
                return resolve()
            }

            const txLedger = rawTx && rawTx.ledger_attr
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
                // Iterate through subscriptions
                for (const subscription of this.observer.subscriptions) {
                    // TODO: ignore subscriptions that were added AFTER the tx ledger close date to prevent false notifications on fast-forwarding
                    // Find subscriptions that match an operation
                    if (matches(subscription, operation)) {
                        // Associate a subscription with current notification
                        notification.subscriptions.push(subscription.id)
                        // Will use it once notifications are persisted
                        relevantSubscriptions.add(subscription)
                        // Mark subscription as ready to be processed
                        subscription.processed = false
                    }
                }

                // Process a notification if at least one match was found
                if (notification.subscriptions.length) {
                    notifications.push(notification)
                }
            }

            this.observer.notifier.createNotifications(notifications)
                .then(createdNotifications => {
                    const savedNotifications = createdNotifications || notifications
                    
                    // Диагностика обработки
                    if (this.processTxCount === undefined) this.processTxCount = 0;
                    this.processTxCount++;
                    
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
                    resolve()
                })
                .catch(err => {
                    console.error(err)
                    resolve() // Don't reject, continue processing other transactions
                })
        })
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
        if (this.releaseStream) return

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
                            this.lastLedger = lastTx.ledger_attr
                            
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
                    setImmediate(() => this.trackTransactions())
                }
            })
            .catch(err => {
                const delay = this.getRateLimitDelay(err)
                if (delay !== null) {
                    this.reconnectDelay = delay
                    logger.debug(`Rate limit hit, retrying in ${delay}ms`)
                    return setTimeout(() => this.trackTransactions(), delay)
                }
                console.error(`[DEBUG] Error in trackTransactions: ${err.message}`)
                // Если проблема с курсором, попробуем перейти на живой стрим
                if (err.message && (
                    err.message.includes('cursor') || 
                    err.message.includes('paging') || 
                    err.message.includes('token')
                )) {
                    logger.debug('Cursor error detected, switching to live stream')
                    this.cursor = null
                    this.trackLiveStream()
                    return
                }
                this.stopWatching()
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
    trackLiveStream() {
        // Если мы уже стримим, не начинаем повторно
        if (this.streaming && this.releaseStream) {
            logger.info('Already streaming ledgers, skipping restart')
            return
        }
        
        // Останавливаем текущий стрим, если он есть
        if (this.releaseStream) {
            this.releaseStream()
            this.releaseStream = null
        }
        
        this.streaming = true
        logger.info('Starting ledger stream...')
        this.releaseStream = horizon
            .ledgers()
            .order('asc')
            .cursor('now')
            .stream({
                onmessage: rawLedger => {
                    this.reconnectDelay = undefined
                    this.lastLedger = rawLedger.sequence
                    this.lastLedgerSeen = rawLedger.sequence
                    logger.info(`Ledger received: ${rawLedger.sequence}`)
                    this.enqueueLedger(rawLedger.sequence)
                },
                onerror: err => {
                    const status = err && (err.status || (err.response && err.response.status))
                    const headers = err && err.response && err.response.headers
                    const reset = getHeader(headers, 'X-RateLimit-Reset')
                    this.stopWatching()
                    if (status === 429) {
                        const resetValue = parseInt(reset)
                        this.reconnectDelay = (!isNaN(resetValue) && resetValue > 0 ? resetValue : 10) * 1000
                        logger.warn(`Ledger stream error (status 429). Waiting ${this.reconnectDelay / 1000}s before reconnect.`)
                    }
                    else {
                        const detail = status ? `status ${status}` : (err && err.message ? err.message : 'unknown error')
                        //initiate reconnection sequence with exponential backoff
                        if (this.reconnectDelay) {
                            this.reconnectDelay *= 2
                        } else {
                            this.reconnectDelay = 1000
                        }
                        if (this.reconnectDelay > 60000) {
                            this.reconnectDelay = 60000
                        }
                        logger.warn(`Ledger stream error (${detail}). Reconnecting in ${this.reconnectDelay / 1000}s...`)
                    }
                    setTimeout(() => this.watch(), this.reconnectDelay)
                }
            })
    }

    getRateLimitDelay(err) {
        if (!err || !err.response || err.response.status !== 429) return null
        const headers = err.response.headers || {}
        const resetHeader = getHeader(headers, 'X-RateLimit-Reset')
        const reset = parseInt(resetHeader)
        const delaySeconds = !isNaN(reset) && reset > 0 ? reset : 10
        logger.warn(`Horizon rate limit reached. Retrying in ${delaySeconds} seconds.`)
        return delaySeconds * 1000
    }

    loadLedgerTransactions(sequence, txCursor) {
        return new Promise((resolve, reject) => {
            let notFoundRetries = 0
            const fetchLedgerTxBatch = (cursor) => {
                fetchTransactions(cursor, sequence)
                    .then(({records}) => {
                        const txCount = records?.length || 0
                        if (!records || !records.length) {
                            this.lastLedgerProcessed = sequence
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
                        this.lastLedgerProcessed = lastTx.ledger_attr
                        
                        // Принудительно обновляем курсор при обработке леджера
                        this.highestProcessedPagingToken = lastTx.paging_token
                        this.cursor = lastTx.paging_token
                        logger.debug(`Ledger processing updated cursor to ${this.cursor.substring(0, 8)}...`)
                        
                        // Сохраняем в базу
                        storage.updateLastIngestedTx(lastTx.paging_token)
                            .catch(err => console.error(`Failed to update ledger cursor: ${err.message}`))
                        
                        if (this.lastLedgerSeen === null && typeof lastTx.ledger_attr === 'number') {
                            this.lastLedgerSeen = lastTx.ledger_attr
                            this.lastLedger = lastTx.ledger_attr
                        }
                        if (fetchedCount < transactionsBatchSize) {
                            logger.info(`Ledger ${sequence} processed (${txCount} transactions)`)
                            return resolve()
                        }
                        fetchLedgerTxBatch(lastTx.paging_token)
                    })
                    .catch(e => {
                        const delay = this.getRateLimitDelay(e)
                        if (delay !== null) {
                            this.reconnectDelay = delay
                            return setTimeout(() => fetchLedgerTxBatch(cursor), delay)
                        }
                        const status = e && e.response && e.response.status
                        if ((status === 404 || status === 502 || status === 503 || status === 504) && notFoundRetries < 5) {
                            notFoundRetries++
                            return setTimeout(() => fetchLedgerTxBatch(cursor), 1000)
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
        if (this.releaseStream) {
            this.releaseStream()
            this.releaseStream = null
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
            lastLedger: this.lastLedgerSeen ?? this.lastLedger ?? null,
            lastLedgerSeen: this.lastLedgerSeen ?? null,
            lastLedgerProcessed: this.lastLedgerProcessed ?? null,
            ledgerLag,
            lastTxPagingToken: this.lastTxPagingToken,
            lastTxHash: this.lastTxHash,
            queueLength: this.queue.length,
            ledgerQueueLength: this.ledgerQueue.length,
            ledgerInProgress: this.ledgerInProgress,
            ledgerWorkers: this.maxLedgerWorkers,
            txInProgress: this.txInProgress,
            txWorkers: this.maxTxWorkers,
            reconnectDelay: this.reconnectDelay
        }
    }
}

module.exports = TransactionWatcher
