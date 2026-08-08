"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRosterStorage } = require("../ui/roster-storage.js");

function memoryLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function memoryIndexedDB(initial) {
  const values = new Map(initial == null ? [] : [["saved-rosters", initial]]);
  let created = initial != null;
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    close: () => {},
    transaction: () => {
      const transaction = {
        error: null,
        objectStore: () => ({
          get: key => {
            const request = {};
            queueMicrotask(() => {
              request.result = values.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          put: (value, key) => {
            values.set(key, value);
            setTimeout(() => transaction.oncomplete?.(), 0);
          }
        })
      };
      return transaction;
    }
  };
  return {
    open: () => {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        if (!created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
    values
  };
}

test("falls back to localStorage when IndexedDB is unavailable", async () => {
  const localStorage = memoryLocalStorage();
  const storage = createRosterStorage({ localStorage });
  await storage.initialize();
  await storage.save([{ id: "one", document: {} }]);
  assert.deepEqual(storage.current(), [{ id: "one", document: {} }]);
  assert.equal(storage.status().backend, "localstorage");
  assert.match(localStorage.getItem("engineRosterSaves"), /"id":"one"/);
});

test("reports quota failures without discarding the in-memory synced library", async () => {
  const localStorage = memoryLocalStorage();
  localStorage.setItem = () => { throw new Error("The quota has been exceeded."); };
  const storage = createRosterStorage({ localStorage });
  await storage.initialize();
  const saves = [{ id: "cloud-roster", document: { name: "Recovered" } }];
  await assert.rejects(storage.save(saves), /quota has been exceeded/i);
  assert.deepEqual(storage.current(), saves);
});

test("migrates a large iPad roster library to IndexedDB before removing the quota-limited copy", async () => {
  const largeText = "datasheet rules ".repeat(400000);
  const saves = [{ id: "large-roster", document: { name: "iPad library", rules: largeText } }];
  const localStorage = memoryLocalStorage({ engineRosterSaves: JSON.stringify(saves) });
  localStorage.setItem = () => { throw new Error("The quota has been exceeded."); };
  const indexedDB = memoryIndexedDB();
  const storage = createRosterStorage({ localStorage, indexedDB });

  await storage.initialize();
  assert.equal(storage.status().backend, "indexeddb");
  assert.equal(localStorage.getItem("engineRosterSaves"), null);
  assert.deepEqual(indexedDB.values.get("saved-rosters"), saves);

  const synced = [...saves, { id: "cloud-roster", document: { name: "Synced" } }];
  await storage.save(synced);
  assert.deepEqual(indexedDB.values.get("saved-rosters"), synced);
});

test("refuses to overwrite malformed legacy roster data", async () => {
  const localStorage = memoryLocalStorage({ engineRosterSaves: "{broken" });
  const storage = createRosterStorage({ localStorage });
  await assert.rejects(storage.initialize());
  assert.equal(localStorage.getItem("engineRosterSaves"), "{broken");
});
