const {xdr} = require('@stellar/stellar-sdk')

/**
 * All known operation types of the bundled XDR definitions.
 *
 * stellar-sdk v17 exposes enums as static instances on the class
 * (`xdr.OperationType.payment` etc.) instead of the v16 `_members` map,
 * so non-member statics (e.g. `schema`) are filtered out here.
 *
 * @returns {Array<{name: string, value: number}>}
 */
function getOperationTypeMembers() {
    return Object.values(xdr.OperationType)
        .filter(member => member instanceof xdr.OperationType)
        .map(({name, value}) => ({name, value}))
}

module.exports = {getOperationTypeMembers}
