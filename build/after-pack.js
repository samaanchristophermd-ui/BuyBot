'use strict'

const { execFileSync } = require('child_process')

// Folders synced by iCloud (Desktop, Documents) and files unpacked from a
// download carry Finder attributes that make codesign fail with
// "resource fork, Finder information, or similar detritus not allowed".
// Strip them from the packaged app just before it is signed.
module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') return
  execFileSync('xattr', ['-cr', context.appOutDir])
}
