function maskTokenPreview(token) {
    if (!token) return 'not set'
    return 'configured'
}

function sanitizeUrlForLogs(rawUrl) {
    if (!rawUrl) return rawUrl

    try {
        const parsed = new URL(rawUrl)
        if (parsed.username) parsed.username = '***'
        if (parsed.password) parsed.password = '***'

        if (parsed.search) {
            for (const key of [...parsed.searchParams.keys()]) {
                parsed.searchParams.set(key, '***')
            }
        }

        const pathname = parsed.pathname || ''
        const parts = pathname.split('/').filter(Boolean)
        if (parts.length > 1) {
            parts[parts.length - 1] = '***'
            parsed.pathname = `/${parts.join('/')}`
        }

        return parsed.toString()
    } catch (e) {
        return rawUrl
    }
}

module.exports = {
    maskTokenPreview,
    sanitizeUrlForLogs
}
