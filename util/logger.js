/**
 * Simple logger with configurable level support
 */
const config = require('../models/config')

// Уровни логирования
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
}

// Получаем уровень из конфига или по умолчанию INFO
let currentLevel = LOG_LEVELS.INFO
if (config.logLevel) {
    const configLevel = config.logLevel.toUpperCase()
    if (LOG_LEVELS[configLevel] !== undefined) {
        currentLevel = LOG_LEVELS[configLevel]
    }
}

// Функция проверки уровня
function shouldLog(level) {
    return level >= currentLevel
}

// Методы логирования
function debug(message) {
    if (shouldLog(LOG_LEVELS.DEBUG)) {
        console.log(`[DEBUG] ${message}`)
    }
}

function info(message) {
    if (shouldLog(LOG_LEVELS.INFO)) {
        console.log(message)
    }
}

function warn(message) {
    if (shouldLog(LOG_LEVELS.WARN)) {
        console.warn(message)
    }
}

function error(message) {
    if (shouldLog(LOG_LEVELS.ERROR)) {
        console.error(message)
    }
}

module.exports = {
    debug,
    info,
    warn,
    error,
    LOG_LEVELS
}