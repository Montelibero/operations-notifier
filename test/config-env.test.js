const { execFileSync } = require('child_process')
const { expect } = require('chai')
const path = require('path')

describe('Config env parsing', function () {
    it('parses USER_TOKENS from environment', function () {
        const script = 'const config=require("./models/config"); console.log(JSON.stringify(config.userTokens))'
        const output = execFileSync(process.execPath, ['-e', script], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                USER_TOKENS: 'tokenA'
            }
        }).toString().trim()

        expect(output).to.equal('["tokenA"]')
    })
})
