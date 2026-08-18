/**
 * Portable receipt backup: dumps the receipts table (the one thing that cannot be
 * regenerated) to a timestamped JSON file in BACKUP_DIR. Host-agnostic — a cloud
 * cron then syncs BACKUP_DIR off-host (e.g. `aws s3 sync` to S3, or rclone to R2).
 *
 *   npm run backup                 # dump all receipts
 *   BACKUP_DIR=/data/backups npm run backup
 *
 * Findings are intentionally NOT backed up — they are rebuilt by re-ingesting.
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { openDb } = require("./db");

function backupReceipts(dbPath = config.dbPath, backupDir = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups")) {
  const db = openDb(dbPath);
  try {
    const receipts = db.prepare("SELECT * FROM receipts ORDER BY created_at").all();
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupDir, `receipts-${stamp}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ exported_at: new Date().toISOString(), count: receipts.length, receipts }, null, 2)
    );
    return { file, count: receipts.length };
  } finally {
    db.close();
  }
}

module.exports = { backupReceipts };

if (require.main === module) {
  const { file, count } = backupReceipts();
  console.log(`Backed up ${count} receipt(s) -> ${file}`);
}
