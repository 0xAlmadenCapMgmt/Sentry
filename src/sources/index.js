/**
 * Source registry. To add a source, write an adapter exporting
 * { name, description, url, dataUrl, refresh, namespaces, fetchRecords }
 * and list it here. Findings are never merged across sources.
 */
const ofac = require("./ofac");
const scamsniffer = require("./scamsniffer");
const mewDarklist = require("./mew-darklist");

const SOURCES = [ofac, scamsniffer, mewDarklist];

function sourcesForNamespace(namespace) {
  return SOURCES.filter((s) => s.namespaces.includes(namespace));
}

module.exports = { SOURCES, sourcesForNamespace };
