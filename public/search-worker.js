// @ts-check
/** @typedef {{key: string, title: string, project: string, id: string, action: string, icon: string, subtitle: string, messages?: string[], blob?: Blob}} SearchEntry */
/** @type {Map<string, SearchEntry & {index: string}>} */
const entries = new Map();
let queue = Promise.resolve();

/** @param {MessageEvent<{id: number, removed: string[], changed: SearchEntry[], query: string}>} event */
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, removed, changed, query } = data;
    try {
      for (const key of removed) entries.delete(key);
      for (const entry of changed) {
        const { messages, blob, ...metadata } = entry;
        const content = [entry.title, ...(messages || [])].join("\n");
        const file = blob ? await blob.text() : "";
        entries.set(entry.key, {
          ...metadata,
          index: `${content}\n${file}`.toLocaleLowerCase("ru"),
        });
      }
      const match = query.trim().toLocaleLowerCase("ru");
      const rows = [];
      for (const entry of entries.values()) {
        if (!match || entry.index.includes(match)) {
          const { id, title, project, action, icon, subtitle } = entry;
          rows.push({ id, title, project, action, icon, subtitle });
        }
        if (rows.length === 30) break;
      }
      self.postMessage({ id, rows });
    } catch {
      self.postMessage({ id, error: "Не удалось построить индекс поиска." });
    }
  });
};
