"use strict";

(function installRosterStorage(global) {
  const LEGACY_KEY = "engineRosterSaves";
  const DATABASE_NAME = "arcadien-army-assembler";
  const STORE_NAME = "roster-libraries";
  const LIBRARY_KEY = "saved-rosters";

  const requestResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage request failed."));
  });

  const transactionComplete = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Browser storage transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Browser storage transaction was cancelled."));
  });

  function openDatabase(indexedDB) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked by another app tab."));
    });
  }

  function createRosterStorage(environment = global) {
    const local = environment.localStorage;
    const indexedDB = environment.indexedDB;
    let database = null;
    let library = [];
    let backend = "memory";
    let initialized = false;
    let initialization = null;
    let writeQueue = Promise.resolve();

    function readLegacy() {
      const raw = local?.getItem?.(LEGACY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("The saved-roster library has an invalid structure.");
      return parsed;
    }

    async function readDatabase() {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const value = await requestResult(transaction.objectStore(STORE_NAME).get(LIBRARY_KEY));
      if (value != null && !Array.isArray(value)) throw new Error("The saved-roster database has an invalid structure.");
      return value ?? null;
    }

    async function writeDatabase(value) {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, LIBRARY_KEY);
      await transactionComplete(transaction);
    }

    async function initialize() {
      if (initialized) return status();
      if (initialization) return initialization;
      initialization = (async () => {
        const legacy = readLegacy();
        if (indexedDB?.open) {
          try {
            database = await openDatabase(indexedDB);
            const stored = await readDatabase();
            library = stored ?? legacy ?? [];
            backend = "indexeddb";
            if (stored == null && legacy != null) {
              await writeDatabase(legacy);
              local?.removeItem?.(LEGACY_KEY);
            }
            initialized = true;
            return status();
          } catch (error) {
            database?.close?.();
            database = null;
            if (/invalid structure/i.test(error?.message || "")) throw error;
          }
        }
        library = legacy ?? [];
        backend = "localstorage";
        initialized = true;
        return status();
      })();
      return initialization;
    }

    function current() {
      if (!initialized) throw new Error("Roster storage has not finished loading.");
      return library;
    }

    function save(value) {
      if (!initialized) return Promise.reject(new Error("Roster storage has not finished loading."));
      if (!Array.isArray(value)) return Promise.reject(new Error("The roster library is invalid and was not saved."));
      library = value;
      const operation = writeQueue.catch(() => undefined).then(async () => {
        if (backend === "indexeddb") return writeDatabase(value);
        const serialized = JSON.stringify(value);
        local?.setItem?.(LEGACY_KEY, serialized);
        if (local?.getItem?.(LEGACY_KEY) !== serialized) throw new Error("Browser storage did not retain the saved data.");
      });
      writeQueue = operation;
      return operation.catch(error => {
        throw new Error(`This device could not save the roster library (${error.message}). Export JSON before leaving this page.`);
      });
    }

    const flush = () => writeQueue;
    const status = () => ({ backend, initialized, count: library.length });
    return { initialize, current, save, flush, status };
  }

  global.ArcadienRosterStorage = createRosterStorage(global);
  if (typeof module !== "undefined" && module.exports) module.exports = { createRosterStorage };
})(typeof window !== "undefined" ? window : globalThis);
