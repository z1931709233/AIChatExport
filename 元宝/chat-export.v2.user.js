// ==UserScript==
// @name         元宝Chat Export Toolkit
// @namespace    https://github.com/gandli/chat-export-toolkit
// @version      0.6.0
// @author       gandli
// @description  Export current Yuanbao conversations or stream full history to local JSON/Markdown folders
// @license      MIT
// @match        *://yuanbao.tencent.com/*
// @match        *://*.yuanbao.tencent.com/*
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  class BrowserStore {
    constructor() {
      __publicField(this, "prefix", "chat-export:");
      __publicField(this, "databasePromise", null);
    }
    shouldUseIndexedDb(key) {
      return key.startsWith("cache:");
    }
    openDatabase() {
      if (this.databasePromise) return this.databasePromise;
      if (typeof indexedDB === "undefined") return Promise.resolve(null);
      this.databasePromise = new Promise((resolve) => {
        const request = indexedDB.open("chat-export-toolkit", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("cache")) {
            request.result.createObjectStore("cache");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          console.warn("[Store] IndexedDB unavailable; falling back to localStorage", request.error);
          resolve(null);
        };
      });
      return this.databasePromise;
    }
    async getFromIndexedDb(key) {
      const database = await this.openDatabase();
      if (!database) return null;
      return new Promise((resolve, reject) => {
        const request = database.transaction("cache", "readonly").objectStore("cache").get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    }
    async setInIndexedDb(key, value) {
      const database = await this.openDatabase();
      if (!database) return false;
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("cache", "readwrite");
        transaction.objectStore("cache").put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return true;
    }
    async deleteFromIndexedDb(key) {
      const database = await this.openDatabase();
      if (!database) return;
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("cache", "readwrite");
        transaction.objectStore("cache").delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
    async indexedDbEntries() {
      const database = await this.openDatabase();
      if (!database) return [];
      return new Promise((resolve, reject) => {
        const store = database.transaction("cache", "readonly").objectStore("cache");
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();
        let keys = null;
        let values = null;
        const finish = () => {
          if (!keys || !values) return;
          resolve(keys.map((key, index) => [String(key), values[index]]));
        };
        keysRequest.onsuccess = () => {
          keys = keysRequest.result;
          finish();
        };
        valuesRequest.onsuccess = () => {
          values = valuesRequest.result;
          finish();
        };
        keysRequest.onerror = () => reject(keysRequest.error);
        valuesRequest.onerror = () => reject(valuesRequest.error);
      });
    }
    /**
     * 检查存储是否可用
     */
    isAvailable() {
      try {
        return typeof localStorage !== "undefined" || typeof indexedDB !== "undefined";
      } catch {
        return false;
      }
    }
    /**
     * 存储数据
     */
    async set(key, value) {
      const fullKey = this.prefix + key;
      try {
        if (this.shouldUseIndexedDb(key) && await this.setInIndexedDb(key, value)) {
          console.log(`[Store] Set IndexedDB ${key}`);
          return;
        }
        const serialized = JSON.stringify(value);
        localStorage.setItem(fullKey, serialized);
        console.log(`[Store] Set ${fullKey}`);
      } catch (error) {
        console.error(`[Store] Failed to set ${fullKey}:`, error);
        throw error;
      }
    }
    /**
     * 读取数据
     */
    async get(key) {
      const fullKey = this.prefix + key;
      try {
        if (this.shouldUseIndexedDb(key)) {
          const indexedValue = await this.getFromIndexedDb(key);
          if (indexedValue !== null) return indexedValue;
        }
        const serialized = localStorage.getItem(fullKey);
        if (!serialized) return null;
        return JSON.parse(serialized);
      } catch (error) {
        console.error(`[Store] Failed to get ${fullKey}:`, error);
        return null;
      }
    }
    /**
     * 删除数据
     */
    async delete(key) {
      const fullKey = this.prefix + key;
      try {
        if (this.shouldUseIndexedDb(key)) await this.deleteFromIndexedDb(key);
        localStorage.removeItem(fullKey);
        console.log(`[Store] Deleted ${fullKey}`);
      } catch (error) {
        console.error(`[Store] Failed to delete ${fullKey}:`, error);
        throw error;
      }
    }
    /**
     * 查询数据
     */
    async query(pattern, options) {
      const results = [];
      const regex = new RegExp(`^${this.prefix}${pattern.replace(/\*/g, ".*")}$`);
      const seenKeys = /* @__PURE__ */ new Set();
      try {
        const logicalRegex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
        for (const [key, value] of await this.indexedDbEntries()) {
          if (logicalRegex.test(key)) {
            results.push(value);
            seenKeys.add(key);
          }
        }
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && regex.test(key)) {
            const logicalKey = key.replace(this.prefix, "");
            if (seenKeys.has(logicalKey)) continue;
            const value = await this.get(logicalKey);
            if (value) {
              results.push(value);
            }
          }
        }
        if (options == null ? void 0 : options.sortBy) {
          const sortKey = options.sortBy;
          const order = options.sortOrder === "desc" ? -1 : 1;
          results.sort((a, b) => {
            const aVal = a[sortKey] || 0;
            const bVal = b[sortKey] || 0;
            return (aVal - bVal) * order;
          });
        }
        if (options == null ? void 0 : options.offset) {
          results.splice(0, options.offset);
        }
        if (options == null ? void 0 : options.limit) {
          results.splice(options.limit);
        }
        return results;
      } catch (error) {
        console.error(`[Store] Failed to query ${pattern}:`, error);
        return [];
      }
    }
    /**
     * 清空存储
     */
    async clear() {
      try {
        const database = await this.openDatabase();
        if (database) {
          await new Promise((resolve, reject) => {
            const transaction = database.transaction("cache", "readwrite");
            transaction.objectStore("cache").clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
          });
        }
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(this.prefix)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        console.log(`[Store] Cleared all data with prefix ${this.prefix}`);
      } catch (error) {
        console.error(`[Store] Failed to clear:`, error);
        throw error;
      }
    }
  }
  class MemoryStore {
    constructor() {
      __publicField(this, "store", /* @__PURE__ */ new Map());
    }
    isAvailable() {
      return true;
    }
    async set(key, value) {
      this.store.set(key, value);
      console.log(`[MemoryStore] Set ${key}`);
    }
    async get(key) {
      return this.store.get(key) || null;
    }
    async delete(key) {
      this.store.delete(key);
      console.log(`[MemoryStore] Deleted ${key}`);
    }
    async query(pattern, options) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
      const results = [];
      for (const [key, value] of this.store.entries()) {
        if (regex.test(key)) {
          results.push(value);
        }
      }
      if (options == null ? void 0 : options.sortBy) {
        const sortKey = options.sortBy;
        const order = options.sortOrder === "desc" ? -1 : 1;
        results.sort((a, b) => {
          const aVal = a[sortKey] || 0;
          const bVal = b[sortKey] || 0;
          return (aVal - bVal) * order;
        });
      }
      if (options == null ? void 0 : options.offset) results.splice(0, options.offset);
      if (options == null ? void 0 : options.limit) results.splice(options.limit);
      return results;
    }
    async clear() {
      this.store.clear();
      console.log("[MemoryStore] Cleared all data");
    }
  }
  function createStore() {
    return typeof localStorage !== "undefined" ? new BrowserStore() : new MemoryStore();
  }
  const asRecord$1 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  function firstIdentifier(record) {
    for (const key of ["conversationId", "conversation_id", "convId", "conversationUuid", "sessionId", "chatId", "id"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
      if (typeof value === "number") return String(value);
    }
    return "";
  }
  function firstString(record, keys) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value || typeof value === "number") return String(value);
    }
    return void 0;
  }
  function cacheKey(agentId, conversationId) {
    return `cache:conversation:${encodeURIComponent(agentId || "default")}:${encodeURIComponent(conversationId)}`;
  }
  function cacheMetadataKey(agentId, conversationId) {
    return `cache:yuanbao-meta:${encodeURIComponent(agentId || "default")}:${encodeURIComponent(conversationId)}`;
  }
  function withListMetadata(rawConversation, listRecord) {
    const detail = asRecord$1(rawConversation.data);
    if (!detail) return rawConversation;
    return {
      ...rawConversation,
      data: {
        ...detail,
        _exportListMetadata: {
          conversationId: firstIdentifier(listRecord),
          projectId: firstString(listRecord, ["projectId", "project_id"]),
          projectName: firstString(listRecord, ["projectName", "project_name"]) || "其他",
          serverUpdatedTime: firstString(listRecord, ["updateTime", "updatedAt", "update_time", "modifiedAt"])
        }
      }
    };
  }
  async function collectAllConversations(adapter, store, options = {}) {
    var _a, _b, _c, _d;
    const listed = await adapter.listConversations();
    const unique = /* @__PURE__ */ new Map();
    for (const raw of listed) {
      const record = asRecord$1(raw.data);
      if (!record) continue;
      const id = firstIdentifier(record);
      if (id) unique.set(id, { raw, record });
    }
    const rawConversations = [];
    const failures = [];
    let downloadedCount = 0;
    let cacheHitCount = 0;
    let refreshedCount = 0;
    const delayMs = Math.max(0, options.conversationDelayMs ?? 350);
    const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const entries = Array.from(unique.entries());
    const retainRawConversations = options.retainRawConversations !== false;
    const legacyCache = /* @__PURE__ */ new Map();
    for (const candidate of await store.query("cache:conversation:*")) {
      const candidateRecord = asRecord$1(candidate == null ? void 0 : candidate.data);
      if (!candidateRecord) continue;
      const candidateId = firstIdentifier(candidateRecord);
      if (candidateId) legacyCache.set(candidateId, candidate);
    }
    for (let index = 0; index < entries.length; index++) {
      const [conversationId, { record }] = entries[index];
      const agentId = firstString(record, ["agentId", "agent_id"]);
      const serverUpdatedTime = firstString(record, ["updateTime", "updatedAt", "update_time", "modifiedAt"]);
      const rawKey = cacheKey(agentId, conversationId);
      const metaKey = cacheMetadataKey(agentId, conversationId);
      const cached = await store.get(rawKey) || legacyCache.get(conversationId) || null;
      const cachedMetadata = await store.get(metaKey);
      const timestampMatches = Boolean(
        cached && serverUpdatedTime && (cachedMetadata == null ? void 0 : cachedMetadata.serverUpdatedTime) === serverUpdatedTime
      );
      const mayResume = Boolean(cached && (timestampMatches || !serverUpdatedTime));
      if (!options.forceFullExport && mayResume) {
        const decoratedCached = withListMetadata(cached, record);
        if (retainRawConversations) rawConversations.push(decoratedCached);
        cacheHitCount++;
        await ((_a = options.onConversation) == null ? void 0 : _a.call(options, decoratedCached, {
          completed: index + 1,
          total: entries.length,
          conversationId,
          source: "cache"
        }));
        (_b = options.onProgress) == null ? void 0 : _b.call(options, index + 1, entries.length, conversationId);
        continue;
      }
      let delivered = null;
      let deliveredSource = "download";
      try {
        const downloaded = await adapter.getConversation(conversationId, { forceRefresh: true });
        if (!downloaded) throw new Error("Conversation detail request returned no data");
        await store.set(rawKey, downloaded);
        await store.set(metaKey, {
          conversationId,
          agentId,
          serverUpdatedTime,
          cachedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        delivered = withListMetadata(downloaded, record);
        downloadedCount++;
        if (cached) refreshedCount++;
      } catch (error) {
        const usedStaleCache = cached !== null;
        if (cached) {
          delivered = cached;
          deliveredSource = "stale-cache";
        }
        failures.push({
          conversationId,
          error: error instanceof Error ? error.message : String(error),
          usedStaleCache
        });
      }
      if (delivered) {
        if (retainRawConversations) rawConversations.push(delivered);
        await ((_c = options.onConversation) == null ? void 0 : _c.call(options, delivered, {
          completed: index + 1,
          total: entries.length,
          conversationId,
          source: deliveredSource
        }));
      }
      (_d = options.onProgress) == null ? void 0 : _d.call(options, index + 1, entries.length, conversationId);
      if (index < entries.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    return {
      rawConversations,
      listedCount: entries.length,
      downloadedCount,
      cacheHitCount,
      refreshedCount,
      failures
    };
  }
  class RuntimeBridge {
    constructor(config = {}) {
      __publicField(this, "config");
      const environment = config.environment || this.detectEnvironment();
      const caps = config.capabilities || {};
      this.config = {
        environment,
        capabilities: {
          environment,
          canAccessDOM: caps.canAccessDOM ?? typeof document !== "undefined",
          canAccessFileSystem: caps.canAccessFileSystem ?? typeof process !== "undefined",
          canMakeNetworkRequests: caps.canMakeNetworkRequests ?? typeof fetch !== "undefined",
          canStoreData: caps.canStoreData ?? typeof localStorage !== "undefined"
        }
      };
    }
    /**
     * 运行时能力
     */
    get capabilities() {
      return this.config.capabilities;
    }
    /**
     * 检测运行时环境
     */
    detectEnvironment() {
      var _a;
      if (typeof window !== "undefined") {
        if (typeof GM_info !== "undefined" || typeof unsafeWindow !== "undefined") {
          return "userscript";
        }
        return "browser";
      }
      if (typeof process !== "undefined" && ((_a = process.versions) == null ? void 0 : _a.node)) {
        return "node";
      }
      return "browser";
    }
    /**
     * 初始化
     */
    async init() {
      console.log("[RuntimeBridge] Initializing...", {
        environment: this.config.environment,
        capabilities: this.capabilities
      });
      switch (this.config.environment) {
        case "userscript":
          await this.initUserscript();
          break;
        case "browser":
          await this.initBrowser();
          break;
        case "node":
          await this.initNode();
          break;
      }
      console.log("[RuntimeBridge] Initialized successfully");
    }
    /**
     * Userscript 环境初始化
     */
    async initUserscript() {
      console.log("[RuntimeBridge] Userscript environment detected");
    }
    /**
     * 浏览器环境初始化
     */
    async initBrowser() {
      console.log("[RuntimeBridge] Browser environment detected");
    }
    /**
     * Node.js 环境初始化
     */
    async initNode() {
      console.log("[RuntimeBridge] Node.js environment detected");
    }
    /**
     * 发起 HTTP 请求
     */
    async fetch(url, options) {
      console.log(`[RuntimeBridge] Fetch: ${url}`);
      if (this.config.environment === "node") {
        return fetch(url, options);
      }
      if (typeof GM_xmlhttpRequest !== "undefined") {
        return this.gmFetch(url, options);
      }
      return fetch(url, options);
    }
    /**
     * GM API fetch 封装
     */
    gmFetch(url, options) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === "undefined") {
          reject(new Error("GM_xmlhttpRequest not available"));
          return;
        }
        GM_xmlhttpRequest({
          method: (options == null ? void 0 : options.method) || "GET",
          url,
          headers: (options == null ? void 0 : options.headers) || {},
          data: options == null ? void 0 : options.body,
          onload: (response) => {
            resolve({
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              statusText: response.statusText,
              text: () => Promise.resolve(response.responseText),
              json: () => Promise.resolve(JSON.parse(response.responseText)),
              headers: {
                get: (name) => {
                  var _a, _b;
                  return (_b = (_a = response.responseHeaders) == null ? void 0 : _a.split("\n").find((h) => h.startsWith(name))) == null ? void 0 : _b.split(": ")[1];
                }
              }
            });
          },
          onerror: () => reject(new Error(`GM_xhr failed: ${url}`))
        });
      });
    }
    /**
     * 下载文件
     */
    async downloadFile(url, filename) {
      console.log(`[RuntimeBridge] Download: ${url} -> ${filename}`);
      if (this.config.environment === "node") {
        console.warn("[RuntimeBridge] downloadFile not implemented for Node.js yet");
        return;
      }
      const response = await this.fetch(url);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    }
    /**
     * 读取剪贴板
     */
    async readClipboard() {
      var _a;
      if (typeof ((_a = navigator == null ? void 0 : navigator.clipboard) == null ? void 0 : _a.readText) === "function") {
        return navigator.clipboard.readText();
      }
      throw new Error("Clipboard API not available");
    }
    /**
     * 写入剪贴板
     */
    async writeClipboard(text) {
      var _a;
      if (typeof ((_a = navigator == null ? void 0 : navigator.clipboard) == null ? void 0 : _a.writeText) === "function") {
        await navigator.clipboard.writeText(text);
        console.log("[RuntimeBridge] Wrote to clipboard");
      } else {
        throw new Error("Clipboard API not available");
      }
    }
    /**
     * 发送通知
     */
    async notify(title, message) {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body: message });
        console.log(`[RuntimeBridge] Notification: ${title}`);
      } else {
        console.log(`[RuntimeBridge] Notification (console): ${title} - ${message}`);
      }
    }
    /**
     * 清理资源
     */
    dispose() {
      console.log("[RuntimeBridge] Disposed");
    }
  }
  function createRuntimeBridge(config) {
    return new RuntimeBridge(config);
  }
  class BasePlatformAdapter {
    /**
     * 获取单个对话
     * 默认实现返回 null，子类按需覆盖
     */
    async getConversation(conversationId) {
      console.log(`[${this.platform}] getConversation called`, { conversationId });
      return null;
    }
    /**
     * 获取对话列表
     * 默认实现返回空数组，子类必须覆盖
     */
    async listConversations() {
      console.log(`[${this.platform}] listConversations called`);
      return [];
    }
    /**
     * 提取消息列表
     * 默认实现返回空数组，子类必须覆盖
     */
    extractMessages(rawConversation) {
      console.log(`[${this.platform}] extractMessages called`, { rawConversation });
      return [];
    }
    /**
     * 获取平台元数据
     * 可选实现
     */
    async getMetadata() {
      console.log(`[${this.platform}] getMetadata called`);
      return {};
    }
    /**
     * 辅助方法：安全地查询 DOM 元素
     * @param selector CSS 选择器
     * @param context 上下文元素（可选）
     */
    querySelectorSafe(selector, context = document) {
      try {
        return context.querySelector(selector);
      } catch (error) {
        console.warn(`[${this.platform}] Failed to query selector:`, selector, error);
        return null;
      }
    }
    /**
     * 辅助方法：安全地查询所有 DOM 元素
     */
    querySelectorAllSafe(selector, context = document) {
      try {
        return Array.from(context.querySelectorAll(selector));
      } catch (error) {
        console.warn(`[${this.platform}] Failed to query selectors:`, selector, error);
        return [];
      }
    }
    /**
     * 辅助方法：等待元素出现
     * @param selector CSS 选择器
     * @param timeout 超时时间（ms）
     */
    async waitForElement(selector, timeout = 5e3) {
      return new Promise((resolve) => {
        const element = this.querySelectorSafe(selector);
        if (element) {
          resolve(element);
          return;
        }
        const observer = new MutationObserver(() => {
          const el = this.querySelectorSafe(selector);
          if (el) {
            observer.disconnect();
            resolve(el);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      });
    }
  }
  const DETAIL_ENDPOINT = "/api/user/agent/conversation/v1/detail";
  const LIST_ENDPOINT = "/api/user/agent/conversation/list";
  const PROJECTS_ENDPOINT = "/api/v5/projectLogic/project/get-user-projects-with-convs";
  const PROJECT_CONVERSATIONS_ENDPOINT = "/api/user/agent/conversation/v3/list";
  function parseYuanbaoChatUrl(input) {
    try {
      const url = input instanceof URL ? input : new URL(input, "https://yuanbao.tencent.com");
      const match = url.pathname.match(/^\/chat\/([^/?#]+)(?:\/([^/?#]+))?\/?$/);
      if (!match) return null;
      return {
        agentId: decodeURIComponent(match[1]),
        conversationId: match[2] ? decodeURIComponent(match[2]) : void 0
      };
    } catch {
      return null;
    }
  }
  const asRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  function nestedRecords(root) {
    const first = asRecord(root);
    if (!first) return [];
    const result = [];
    const queue = [first];
    const seen = /* @__PURE__ */ new Set();
    while (queue.length > 0 && result.length < 64) {
      const current = queue.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      result.push(current);
      for (const value of Object.values(current)) {
        const nested = asRecord(value);
        if (nested) queue.push(nested);
      }
    }
    return result;
  }
  function toFiniteNumber(value) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : void 0;
  }
  function extractListPage(response) {
    if (Array.isArray(response)) return { items: response };
    const records = nestedRecords(response);
    const container = records.find((record) => Array.isArray(record.conversations));
    const pagination = records.map((record) => asRecord(record.pagination)).find((value) => value !== null);
    return {
      items: (container == null ? void 0 : container.conversations) || [],
      totalResults: toFiniteNumber(pagination == null ? void 0 : pagination.totalResults)
    };
  }
  function extractDetailPage(response) {
    const records = nestedRecords(response);
    const detail = records.find((record) => Array.isArray(record.convs));
    if (!detail) return null;
    const hasMoreRecord = [detail, ...records].find((record) => record.hasMore !== void 0);
    const hasMoreValue = hasMoreRecord == null ? void 0 : hasMoreRecord.hasMore;
    return {
      detail,
      convs: detail.convs,
      hasMore: hasMoreValue === true || hasMoreValue === 1 || hasMoreValue === "1"
    };
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  class YuanbaoAdapter extends BasePlatformAdapter {
    constructor(options = {}) {
      super();
      __publicField(this, "platform", "yuanbao");
      __publicField(this, "fetchFn");
      __publicField(this, "sleep");
      __publicField(this, "configuredAgentId");
      __publicField(this, "listPageSize");
      __publicField(this, "detailPageSize");
      __publicField(this, "requestDelayMs");
      __publicField(this, "retryBaseDelayMs");
      __publicField(this, "maxRetries");
      __publicField(this, "maxPages");
      __publicField(this, "listFilterModes");
      __publicField(this, "capturedConversations", /* @__PURE__ */ new Map());
      __publicField(this, "conversationMetas", /* @__PURE__ */ new Map());
      __publicField(this, "listDiagnostics", []);
      __publicField(this, "projectDiagnostics", []);
      __publicField(this, "lastRequestError");
      __publicField(this, "apiEndpoints", {
        detail: DETAIL_ENDPOINT,
        list: LIST_ENDPOINT,
        discovered: true
      });
      const fetchOwner = typeof window !== "undefined" ? window : globalThis;
      this.fetchFn = options.fetchFn || ((input, init) => fetchOwner.fetch.call(fetchOwner, input, init));
      this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
      this.configuredAgentId = options.agentId;
      this.listPageSize = Math.max(1, options.listPageSize ?? 40);
      this.detailPageSize = Math.max(1, options.detailPageSize ?? 50);
      this.requestDelayMs = Math.max(0, options.requestDelayMs ?? 150);
      this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 500);
      this.maxRetries = Math.max(0, options.maxRetries ?? 3);
      this.maxPages = Math.max(1, options.maxPages ?? 1e4);
      this.listFilterModes = options.listFilterModes || [false, "omit", true];
    }
    detect() {
      if (typeof window === "undefined") return false;
      const hostname = window.location.hostname;
      return hostname === "yuanbao.tencent.com" || hostname.endsWith(".yuanbao.tencent.com");
    }
    async getConversation(conversationId, options = {}) {
      const route = this.getCurrentRoute();
      const targetId = conversationId || (route == null ? void 0 : route.conversationId);
      if (!targetId) return null;
      if (!options.forceRefresh && this.capturedConversations.has(targetId)) {
        return { platform: this.platform, data: this.capturedConversations.get(targetId) };
      }
      const agentId = (route == null ? void 0 : route.agentId) || this.configuredAgentId;
      if (!agentId) {
        console.warn("[YuanbaoAdapter] No agent ID is available");
        return null;
      }
      try {
        const detail = await this.fetchConversationDetail(targetId, agentId);
        if (!detail) return null;
        this.lastRequestError = void 0;
        this.capturedConversations.set(targetId, detail);
        return { platform: this.platform, data: detail };
      } catch (error) {
        this.lastRequestError = errorMessage(error);
        console.error(`[YuanbaoAdapter] Failed to fetch conversation ${targetId}:`, error);
        return null;
      }
    }
    async listConversations() {
      const route = this.getCurrentRoute();
      const agentId = (route == null ? void 0 : route.agentId) || this.configuredAgentId;
      const merged = /* @__PURE__ */ new Map();
      if (agentId) {
        const fetched = await this.fetchConversationList(agentId);
        for (const item of fetched) {
          const id = this.extractConversationId(item);
          if (id) merged.set(id, { ...merged.get(id), ...item, agentId });
        }
        const grouped = await this.fetchGroupedConversationList(agentId);
        for (const item of grouped) {
          const id = this.extractConversationId(item);
          if (id) merged.set(id, { ...merged.get(id), ...item, agentId });
        }
      } else {
        console.warn("[YuanbaoAdapter] Cannot request history without an agent ID; using DOM fallback");
      }
      for (const [id, detail] of this.capturedConversations) {
        if (!merged.has(id)) {
          merged.set(id, {
            conversationId: id,
            title: detail.sessionTitle || detail.title || "Yuanbao Chat",
            agentId
          });
        }
      }
      if (merged.size === 0 && !agentId) {
        for (const meta of this.extractConversationMetasFromDom()) {
          merged.set(meta.id, {
            conversationId: meta.id,
            title: meta.title,
            agentId: meta.agentId || agentId
          });
        }
      }
      return Array.from(merged.values()).map((data) => ({ platform: this.platform, data }));
    }
    extractMessages(rawConversation) {
      if (!(rawConversation == null ? void 0 : rawConversation.data)) return [];
      const data = rawConversation.data;
      const convs = Array.isArray(data.convs) ? data.convs : [];
      return [...convs].sort((a, b) => (toFiniteNumber(a == null ? void 0 : a.index) ?? 0) - (toFiniteNumber(b == null ? void 0 : b.index) ?? 0)).map((turn) => ({ platform: this.platform, data: turn }));
    }
    async getMetadata() {
      var _a;
      return {
        platform: this.platform,
        detected: this.detect(),
        endpointsDiscovered: this.apiEndpoints.discovered,
        endpoints: { detail: this.apiEndpoints.detail, list: this.apiEndpoints.list },
        capturedCount: this.capturedConversations.size,
        agentId: ((_a = this.getCurrentRoute()) == null ? void 0 : _a.agentId) || this.configuredAgentId,
        listFilterDiagnostics: this.listDiagnostics,
        groupedConversationDiagnostics: this.projectDiagnostics,
        lastRequestError: this.lastRequestError
      };
    }
    async discoverApiEndpoints() {
      return this.apiEndpoints;
    }
    getCurrentRoute() {
      if (typeof window === "undefined") return null;
      return parseYuanbaoChatUrl(window.location.href);
    }
    async fetchConversationList(agentId) {
      const allItems = /* @__PURE__ */ new Map();
      const diagnostics = [];
      for (const mode of this.listFilterModes) {
        const modeItems = /* @__PURE__ */ new Map();
        let offset = 0;
        let pagesFetched = 0;
        let totalResults;
        let modeError;
        const seenPageSignatures = /* @__PURE__ */ new Set();
        try {
          while (pagesFetched < this.maxPages) {
            const body = { agentId, offset, limit: this.listPageSize };
            if (mode !== "omit") body.filterGoodQuestion = mode;
            const page = extractListPage(await this.postJson(LIST_ENDPOINT, body));
            pagesFetched++;
            totalResults = page.totalResults ?? totalResults;
            const pageIds = page.items.map((item) => this.extractConversationId(item)).filter(Boolean);
            const signature = pageIds.join("|");
            let newItems = 0;
            for (const item of page.items) {
              const id = this.extractConversationId(item);
              if (!id) continue;
              if (!modeItems.has(id)) newItems++;
              modeItems.set(id, { ...modeItems.get(id), ...item, agentId });
            }
            if (page.items.length === 0) break;
            if (totalResults !== void 0 && modeItems.size >= totalResults) break;
            if (newItems === 0 && seenPageSignatures.has(signature)) {
              console.warn(`[YuanbaoAdapter] Stopping repeated list page at offset ${offset}`);
              break;
            }
            const nextOffset = offset + this.listPageSize;
            if (nextOffset <= offset) break;
            offset = nextOffset;
            seenPageSignatures.add(signature);
            if (this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
          }
        } catch (error) {
          modeError = errorMessage(error);
          console.warn(`[YuanbaoAdapter] List mode ${String(mode)} failed:`, error);
        }
        diagnostics.push({ mode, totalResults, uniqueResults: modeItems.size, pagesFetched, error: modeError });
        for (const [id, item] of modeItems) allItems.set(id, { ...allItems.get(id), ...item });
        if (this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
      }
      this.listDiagnostics = diagnostics;
      if (allItems.size === 0 && diagnostics.every((item) => item.error)) {
        throw new Error(`All Yuanbao list request variants failed: ${diagnostics.map((item) => item.error).join("; ")}`);
      }
      for (const [id, item] of allItems) {
        this.conversationMetas.set(id, {
          id,
          title: this.extractConversationTitle(item),
          agentId,
          serverUpdatedTime: item.updateTime ?? item.updatedAt
        });
      }
      return Array.from(allItems.values());
    }
    /** Discover Yuanbao "groups" (projects) and include every conversation in them. */
    async fetchGroupedConversationList(agentId) {
      const merged = /* @__PURE__ */ new Map();
      const diagnostics = [];
      try {
        const response = await this.postJson(PROJECTS_ENDPOINT, {
          offset: 0,
          page_size: 1e3,
          conv_count: 1e4
        });
        const projects = this.extractProjects(response);
        for (const project of projects) {
          const projectId = this.stringField(project, ["project_id", "projectId", "id"]);
          if (!projectId) continue;
          const projectName = this.stringField(project, ["name", "project_name", "title"]);
          const embedded = this.extractProjectConversationItems(project);
          for (const item of embedded) {
            const id = this.extractConversationId(item);
            if (!id) continue;
            merged.set(id, { ...merged.get(id), ...item, agentId, projectId, projectName });
          }
          let pagesFetched = 0;
          let error;
          try {
            const paged = await this.fetchProjectConversationPages(agentId, projectId);
            pagesFetched = paged.pagesFetched;
            for (const item of paged.items) {
              const id = this.extractConversationId(item);
              if (!id) continue;
              merged.set(id, { ...merged.get(id), ...item, agentId, projectId, projectName });
            }
          } catch (projectError) {
            error = errorMessage(projectError);
            console.warn(`[YuanbaoAdapter] Group ${projectId} pagination failed:`, projectError);
          }
          diagnostics.push({
            projectId,
            projectName,
            conversations: Array.from(merged.values()).filter((item) => item.projectId === projectId).length,
            pagesFetched,
            error
          });
          if (this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
        }
      } catch (error) {
        console.warn("[YuanbaoAdapter] Failed to discover grouped conversations:", error);
        diagnostics.push({ projectId: "*", conversations: 0, pagesFetched: 0, error: errorMessage(error) });
      }
      this.projectDiagnostics = diagnostics;
      for (const [id, item] of merged) {
        this.conversationMetas.set(id, {
          id,
          title: this.extractConversationTitle(item),
          agentId,
          projectId: item.projectId,
          projectName: item.projectName,
          serverUpdatedTime: item.updateTime ?? item.updatedAt
        });
      }
      return Array.from(merged.values());
    }
    extractProjects(response) {
      for (const record of nestedRecords(response)) {
        if (!Array.isArray(record.items)) continue;
        const items = record.items.map(asRecord).filter((item) => item !== null);
        if (items.some((item) => this.stringField(item, ["project_id", "projectId"]))) return items;
      }
      return [];
    }
    extractProjectConversationItems(project) {
      const conversationList = asRecord(project.conversation_list) || asRecord(project.conversationList);
      if (!conversationList) return [];
      for (const key of ["list", "conversations", "items"]) {
        if (Array.isArray(conversationList[key])) return conversationList[key];
      }
      return [];
    }
    async fetchProjectConversationPages(agentId, projectId) {
      const items = /* @__PURE__ */ new Map();
      const seenCursors = /* @__PURE__ */ new Set();
      let cursor = {};
      let pagesFetched = 0;
      for (; pagesFetched < this.maxPages; pagesFetched++) {
        const body = {
          agent_id: agentId,
          project_id: projectId,
          page_size: this.listPageSize,
          ...cursor
        };
        if (pagesFetched > 0) body.action = "next";
        const response = await this.postJson(PROJECT_CONVERSATIONS_ENDPOINT, body);
        const page = this.extractV3ConversationPage(response);
        let newItems = 0;
        for (const item of page.items) {
          const id = this.extractConversationId(item);
          if (!id) continue;
          if (!items.has(id)) newItems++;
          items.set(id, { ...items.get(id), ...item });
        }
        if (!page.hasMore || page.items.length === 0) {
          pagesFetched++;
          break;
        }
        const last = page.items[page.items.length - 1];
        const lastRepliedAt = last.last_replied_at ?? last.lastRepliedAt ?? last.updateTime ?? last.updatedAt;
        const topTime = last.top_time ?? last.topTime ?? 0;
        const signature = `${String(lastRepliedAt)}|${String(topTime)}`;
        if (lastRepliedAt === void 0 || seenCursors.has(signature) || newItems === 0) break;
        seenCursors.add(signature);
        cursor = { last_replied_at: lastRepliedAt, top_time: topTime };
        if (this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
      }
      return { items: Array.from(items.values()), pagesFetched };
    }
    extractV3ConversationPage(response) {
      const records = nestedRecords(response);
      const container = records.find(
        (record) => ["list", "conversations", "items"].some((key) => Array.isArray(record[key]))
      );
      const listKey = ["list", "conversations", "items"].find((key) => Array.isArray(container == null ? void 0 : container[key]));
      const hasMoreRecord = records.find(
        (record) => record.has_more !== void 0 || record.hasMore !== void 0
      );
      const hasMore = (hasMoreRecord == null ? void 0 : hasMoreRecord.has_more) ?? (hasMoreRecord == null ? void 0 : hasMoreRecord.hasMore);
      return {
        items: listKey ? container == null ? void 0 : container[listKey] : [],
        hasMore: hasMore === true || hasMore === 1 || hasMore === "1"
      };
    }
    stringField(record, keys) {
      for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value) return value;
        if (typeof value === "number") return String(value);
      }
      return void 0;
    }
    async fetchConversationDetail(conversationId, agentId) {
      const rawPages = [];
      const turns = [];
      const seenTurns = /* @__PURE__ */ new Set();
      let firstDetail = null;
      let offset = 0;
      const seenOffsets = /* @__PURE__ */ new Set([offset]);
      const seenPageSignatures = /* @__PURE__ */ new Set();
      let paginationComplete = false;
      for (let pageNumber = 0; pageNumber < this.maxPages; pageNumber++) {
        const response = await this.postJson(DETAIL_ENDPOINT, {
          conversationId,
          offset,
          limit: this.detailPageSize,
          agentId
        });
        rawPages.push(response);
        const page = extractDetailPage(response);
        if (!page) throw new Error(`Yuanbao detail response for ${conversationId} has no convs array`);
        if (!firstDetail) firstDetail = page.detail;
        const pageKeys = [];
        let newTurns = 0;
        for (const turn of page.convs) {
          const key = this.turnKey(turn);
          pageKeys.push(key);
          if (seenTurns.has(key)) continue;
          seenTurns.add(key);
          turns.push(turn);
          newTurns++;
        }
        if (!page.hasMore) {
          paginationComplete = true;
          break;
        }
        if (page.convs.length === 0) {
          console.warn(`[YuanbaoAdapter] Empty detail page with hasMore=true for ${conversationId}`);
          break;
        }
        const signature = pageKeys.join("|");
        if (newTurns === 0 && seenPageSignatures.has(signature)) {
          console.warn(`[YuanbaoAdapter] Stopping repeated detail page for ${conversationId}`);
          break;
        }
        const lastTurn = page.convs[page.convs.length - 1];
        const nextOffset = toFiniteNumber(lastTurn == null ? void 0 : lastTurn.index);
        if (nextOffset === void 0) {
          console.warn(`[YuanbaoAdapter] Missing detail cursor index for ${conversationId}`);
          break;
        }
        if (seenOffsets.has(nextOffset)) break;
        offset = nextOffset;
        seenOffsets.add(nextOffset);
        seenPageSignatures.add(signature);
        if (this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
      }
      if (!firstDetail) return null;
      if (!paginationComplete) {
        throw new Error(`Detail pagination for ${conversationId} stopped before hasMore=false`);
      }
      const indexedTurns = turns.map((turn, position) => ({ turn, position }));
      indexedTurns.sort((left, right) => {
        const leftIndex = toFiniteNumber(left.turn.index);
        const rightIndex = toFiniteNumber(right.turn.index);
        if (leftIndex !== void 0 && rightIndex !== void 0 && leftIndex !== rightIndex) return leftIndex - rightIndex;
        const leftTime = toFiniteNumber(left.turn.createTime);
        const rightTime = toFiniteNumber(right.turn.createTime);
        if (leftTime !== void 0 && rightTime !== void 0 && leftTime !== rightTime) return leftTime - rightTime;
        return left.position - right.position;
      });
      return {
        ...firstDetail,
        conversationId,
        agentId,
        convs: indexedTurns.map((item) => item.turn),
        _exportPagination: { complete: true, pageCount: rawPages.length, uniqueTurnCount: turns.length },
        _rawPages: rawPages
      };
    }
    turnKey(turn) {
      const record = turn;
      for (const key of ["messageId", "msgId", "convId", "id"]) {
        const value = record[key];
        if (typeof value === "string" && value || typeof value === "number") return `${key}:${String(value)}`;
      }
      return JSON.stringify([turn.index, turn.speaker, turn.createTime, turn.speechesV2]);
    }
    async postJson(endpoint, body) {
      var _a;
      let lastError;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const response = await this.fetchFn(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            const error = new Error(`Yuanbao API ${endpoint} returned HTTP ${response.status}`);
            if (!retryable) {
              Object.assign(error, { retryable: false });
              throw error;
            }
            if (attempt === this.maxRetries) throw error;
            lastError = error;
          } else {
            return await response.json();
          }
        } catch (error) {
          lastError = error;
          const retryable = (_a = asRecord(error)) == null ? void 0 : _a.retryable;
          if (retryable === false || attempt === this.maxRetries) break;
        }
        const delay = this.retryBaseDelayMs * 2 ** attempt;
        if (delay > 0) await this.sleep(delay);
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    extractConversationId(item) {
      for (const key of ["conversationId", "conversation_id", "convId", "conversationUuid", "sessionId", "chatId", "id"]) {
        const value = item[key];
        if (typeof value === "string" && value) return value;
        if (typeof value === "number") return String(value);
      }
      return "";
    }
    extractConversationTitle(item) {
      for (const key of ["title", "sessionTitle", "name", "conversationTitle", "summary"]) {
        const value = item[key];
        if (typeof value === "string" && value) return value;
      }
      return "Yuanbao Chat";
    }
    extractConversationMetasFromDom() {
      if (typeof document === "undefined") return [];
      const metas = /* @__PURE__ */ new Map();
      for (const anchor of document.querySelectorAll('a[href*="/chat/"]')) {
        const href = anchor.getAttribute("href");
        if (!href) continue;
        const route = parseYuanbaoChatUrl(href);
        if (!(route == null ? void 0 : route.conversationId)) continue;
        metas.set(route.conversationId, {
          id: route.conversationId,
          agentId: route.agentId,
          title: (anchor.textContent || "").trim() || "Yuanbao Chat"
        });
      }
      return Array.from(metas.values());
    }
    handleYuanbaoResponse(text, url) {
      try {
        const raw = JSON.parse(text);
        const page = extractDetailPage(raw);
        if (!page) return;
        const route = parseYuanbaoChatUrl(url) || this.getCurrentRoute();
        const id = (route == null ? void 0 : route.conversationId) || this.extractConversationId(page.detail);
        if (!id) return;
        this.capturedConversations.set(id, {
          ...page.detail,
          conversationId: id,
          agentId: route == null ? void 0 : route.agentId,
          convs: page.convs,
          _rawPages: [raw]
        });
      } catch (error) {
        console.error("[YuanbaoAdapter] Failed to handle detail response:", error);
      }
    }
    handleConversationListResponse(text) {
      var _a;
      try {
        const page = extractListPage(JSON.parse(text));
        const agentId = ((_a = this.getCurrentRoute()) == null ? void 0 : _a.agentId) || this.configuredAgentId;
        for (const item of page.items) {
          const id = this.extractConversationId(item);
          if (!id) continue;
          this.conversationMetas.set(id, {
            id,
            agentId,
            title: this.extractConversationTitle(item),
            serverUpdatedTime: item.updateTime ?? item.updatedAt
          });
        }
      } catch (error) {
        console.error("[YuanbaoAdapter] Failed to handle list response:", error);
      }
    }
  }
  new YuanbaoAdapter();
  const CHATGPT_URL_PATTERNS = [
    /^\/c\/([a-f0-9-]+)$/i,
    // /c/{conversation-id}
    /^\/chat\/([a-f0-9-]+)$/i,
    // /chat/{conversation-id}
    /^\/conversation\/([a-f0-9-]+)$/i
    // /conversation/{conversation-id}
  ];
  class ChatGPTAdapter extends BasePlatformAdapter {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "chatgpt");
      __publicField(this, "apiEndpoints", {
        detail: null,
        list: null,
        discovered: false
      });
      __publicField(this, "capturedConversations", /* @__PURE__ */ new Map());
      __publicField(this, "conversationMetas", /* @__PURE__ */ new Map());
    }
    /**
     * 检测当前页面是否属于 ChatGPT 平台
     * 
     * 检测逻辑：
     * 1. 检查域名是否为 chat.openai.com 或相关域名
     * 2. 检查页面特征（可选）
     */
    detect() {
      if (typeof window === "undefined") {
        return false;
      }
      const hostname = window.location.hostname;
      if (hostname === "chat.openai.com") {
        return true;
      }
      if (hostname.endsWith(".openai.com") || hostname === "chat.com") {
        return true;
      }
      return false;
    }
    /**
     * 获取单个对话的原始数据
     * 
     * 策略：
     * 1. 优先从已捕获的缓存中获取
     * 2. 如果未缓存，尝试通过 API 端点主动获取
     * 3. 支持从 URL 中提取 conversationId
     * 
     * @param conversationId 对话 ID（可选）
     */
    async getConversation(conversationId) {
      console.log("[ChatGPTAdapter] getConversation called", { conversationId });
      if (conversationId && this.capturedConversations.has(conversationId)) {
        const data = this.capturedConversations.get(conversationId);
        return {
          platform: this.platform,
          data
        };
      }
      const idFromUrl = this.extractConversationIdFromUrl();
      const targetId = conversationId || idFromUrl;
      if (!targetId) {
        console.warn("[ChatGPTAdapter] No conversation ID available");
        return null;
      }
      try {
        const detail = await this.fetchConversationDetail(targetId);
        if (detail) {
          this.capturedConversations.set(targetId, detail);
          return {
            platform: this.platform,
            data: detail
          };
        }
      } catch (error) {
        console.error("[ChatGPTAdapter] Failed to fetch conversation:", error);
      }
      console.warn("[ChatGPTAdapter] Falling back to DOM extraction (not implemented)");
      return null;
    }
    /**
     * 获取对话列表的原始数据
     * 
     * 策略：
     * 1. 优先从已拦截的 API 响应中获取
     * 2. 尝试通过 API 端点主动获取
     * 3. 回退到从 DOM 中提取对话元数据
     */
    async listConversations() {
      var _a, _b;
      console.log("[ChatGPTAdapter] listConversations called");
      const metas = [];
      for (const [id, detail] of this.capturedConversations.entries()) {
        const title = detail.title || ((_a = detail.metadata) == null ? void 0 : _a.title) || "ChatGPT Chat";
        metas.push({
          id,
          title,
          createTime: detail.create_time,
          updateTime: detail.update_time,
          model: (_b = detail.metadata) == null ? void 0 : _b.model
        });
      }
      try {
        const listData = await this.fetchConversationList();
        if (listData && Array.isArray(listData)) {
          for (const item of listData) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id && !metas.some((m) => m.id === id)) {
              metas.push({
                id,
                title,
                createTime: item.create_time,
                updateTime: item.update_time,
                model: item.model
              });
            }
          }
        }
      } catch (error) {
        console.warn("[ChatGPTAdapter] Failed to fetch conversation list:", error);
      }
      if (metas.length === 0) {
        const domMetas = this.extractConversationMetasFromDom();
        for (const meta of domMetas) {
          if (!metas.some((m) => m.id === meta.id)) {
            metas.push(meta);
          }
        }
      }
      return metas.map((meta) => ({
        platform: this.platform,
        data: {
          conversationId: meta.id,
          title: meta.title,
          create_time: meta.createTime,
          update_time: meta.updateTime,
          model: meta.model
        }
      }));
    }
    /**
     * 提取消息列表
     * 
     * 将 ChatGPT 的 messages/mapping 数组转换为 RawMessage 数组
     * 
     * @param rawConversation 原始对话数据
     */
    extractMessages(rawConversation) {
      console.log("[ChatGPTAdapter] extractMessages called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[ChatGPTAdapter] Invalid input to extractMessages");
        return [];
      }
      const data = rawConversation.data;
      let messages = [];
      if (Array.isArray(data.messages)) {
        messages = data.messages;
      } else if (data.mapping) {
        messages = this.extractMessagesFromMapping(data.mapping);
      }
      return messages.map((msg) => ({
        platform: this.platform,
        data: msg
      }));
    }
    /**
     * 获取平台元数据
     */
    async getMetadata() {
      return {
        platform: this.platform,
        detected: this.detect(),
        endpointsDiscovered: this.apiEndpoints.discovered,
        capturedCount: this.capturedConversations.size,
        metaCount: this.conversationMetas.size
      };
    }
    // ============================================================================
    // 内部方法：API 端点探测
    // ============================================================================
    /**
     * 动态发现 API 端点
     * 
     * 策略：
     * 1. 从已拦截的请求中选择
     * 2. 从页面 JS 资源中提取
     * 3. 回退到常见端点探测
     */
    async discoverApiEndpoints() {
      if (this.apiEndpoints.discovered) {
        return this.apiEndpoints;
      }
      const endpoints = {
        detail: null,
        list: null,
        discovered: false
      };
      if (!endpoints.detail) {
        console.log("[ChatGPTAdapter] Using fallback probe for detail API");
        endpoints.detail = await this.probeDetailApi();
      }
      if (!endpoints.list) {
        console.log("[ChatGPTAdapter] Using fallback probe for list API");
        endpoints.list = await this.probeListApi();
      }
      console.log("[ChatGPTAdapter] Discovered API endpoints:", endpoints);
      this.apiEndpoints = { ...endpoints, discovered: true };
      return this.apiEndpoints;
    }
    /**
     * 探测 detail API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     */
    async probeDetailApi() {
      console.warn("[ChatGPTAdapter] probeDetailApi not fully implemented");
      return "/backend-api/conversation";
    }
    /**
     * 探测 list API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     */
    async probeListApi() {
      console.warn("[ChatGPTAdapter] probeListApi not fully implemented");
      return "/backend-api/conversations";
    }
    // ============================================================================
    // 内部方法：数据获取
    // ============================================================================
    /**
     * 获取对话详情
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     */
    async fetchConversationDetail(_conversationId) {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.detail) {
        throw new Error("Detail API endpoint not available");
      }
      console.warn("[ChatGPTAdapter] fetchConversationDetail not fully implemented");
      return null;
    }
    /**
     * 获取对话列表
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     */
    async fetchConversationList() {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.list) {
        throw new Error("List API endpoint not available");
      }
      console.warn("[ChatGPTAdapter] fetchConversationList not fully implemented");
      return null;
    }
    // ============================================================================
    // 内部方法：数据提取辅助
    // ============================================================================
    /**
     * 从 URL 中提取 conversationId
     * 
     * ChatGPT 的 URL 模式通常是：
     * - https://chat.openai.com/c/{conversation-id}
     */
    extractConversationIdFromUrl() {
      if (typeof window === "undefined") {
        return "";
      }
      try {
        const url = new URL(window.location.href);
        const pathname = url.pathname;
        for (const pattern of CHATGPT_URL_PATTERNS) {
          const match = pathname.match(pattern);
          if (match && match[1]) {
            return match[1];
          }
        }
        return url.searchParams.get("conversationId") || url.searchParams.get("conversation_id") || url.searchParams.get("id") || "";
      } catch {
        return "";
      }
    }
    /**
     * 从对话项中提取 ID
     */
    extractConversationId(item) {
      return item.conversation_id || item.id || item.conversationId || item.chatId || item.sessionId || "";
    }
    /**
     * 从对话项中提取标题
     */
    extractConversationTitle(item) {
      return item.title || item.conversationTitle || item.name || item.summary || "ChatGPT Chat";
    }
    /**
     * 从 DOM 中提取对话元数据
     * 
     * TODO: 需要根据 ChatGPT 的实际 DOM 结构实现
     */
    extractConversationMetasFromDom() {
      if (typeof document === "undefined") {
        return [];
      }
      const metas = [];
      const seen = /* @__PURE__ */ new Set();
      const links = document.querySelectorAll('a[href*="/c/"]');
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        for (const pattern of CHATGPT_URL_PATTERNS) {
          const match = href.match(pattern);
          if (!match || !match[1]) continue;
          const id = match[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const text = (a.textContent || "").trim();
          metas.push({
            id,
            title: text || "ChatGPT Chat"
          });
          break;
        }
      }
      return metas;
    }
    /**
     * 从 mapping 结构中提取消息
     * 
     * ChatGPT 可能使用树状 mapping 结构来组织消息
     */
    extractMessagesFromMapping(mapping) {
      const messages = [];
      for (const key of Object.keys(mapping)) {
        const node = mapping[key];
        if (node == null ? void 0 : node.message) {
          messages.push(node.message);
        }
      }
      return messages;
    }
    // ============================================================================
    // 内部方法：API 响应拦截（可选）
    // ============================================================================
    /**
     * 安装 API 响应拦截器
     * 
     * TODO: 此方法需要在合适的时机调用（如 userscript 初始化时）
     * 用于拦截 XMLHttpRequest 和 fetch 请求
     */
    installInterceptors() {
      if (typeof window === "undefined") {
        return;
      }
      console.log("[ChatGPTAdapter] installInterceptors not fully implemented");
    }
    /**
     * 处理 ChatGPT 详情响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleChatGPTResponse(text, _url) {
      var _a, _b, _c;
      try {
        const json = JSON.parse(text);
        let convData = null;
        if (Array.isArray(json.messages)) {
          convData = json;
        } else if (json.mapping) {
          convData = json;
        } else if (Array.isArray((_a = json == null ? void 0 : json.data) == null ? void 0 : _a.messages)) {
          convData = json.data;
        } else if ((_b = json == null ? void 0 : json.result) == null ? void 0 : _b.messages) {
          convData = json.result;
        }
        if (!convData) return;
        const idFromUrl = this.extractConversationIdFromUrl();
        const id = idFromUrl || json.id || json.conversation_id || `${Date.now()}`;
        const title = json.title || ((_c = json.metadata) == null ? void 0 : _c.title) || "ChatGPT Chat";
        this.conversationMetas.set(id, { id, title });
        this.capturedConversations.set(id, convData);
        console.log("[ChatGPTAdapter] Captured conversation:", id);
      } catch (error) {
        console.error("[ChatGPTAdapter] Failed to handle response:", error);
      }
    }
    /**
     * 处理 ChatGPT 列表响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleConversationListResponse(text) {
      var _a;
      try {
        const json = JSON.parse(text);
        const items = json.items || json.conversation_items || (Array.isArray(json.data) ? json.data : (_a = json.data) == null ? void 0 : _a.items) || json.result || [];
        const conversations = Array.isArray(items) ? items : [];
        if (conversations.length > 0) {
          for (const item of conversations) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id) {
              this.conversationMetas.set(id, {
                id,
                title,
                createTime: item.create_time,
                updateTime: item.update_time,
                model: item.model
              });
            }
          }
        }
      } catch (error) {
        console.error("[ChatGPTAdapter] Failed to handle list response:", error);
      }
    }
  }
  const DOUBAO_HOSTNAMES = [
    "doubao.com",
    "www.doubao.com",
    "chat.doubao.com",
    "*.doubao.com"
  ];
  const DETAIL_ENDPOINT_CANDIDATES = [
    "/api/conversation/detail",
    "/api/v1/conversation/detail",
    "/api/v2/conversation/detail",
    "/api/chat/detail",
    "/api/conversation/get",
    "/api/conversation/query",
    "/conversation/detail",
    "/conversation/get",
    "/v1/conversation/detail",
    "/v2/conversation/detail"
  ];
  const LIST_ENDPOINT_CANDIDATES = [
    "/api/conversation/list",
    "/api/v1/conversation/list",
    "/api/v2/conversation/list",
    "/api/chat/list",
    "/api/conversations",
    "/api/conversation/page",
    "/conversation/list",
    "/conversations",
    "/v1/conversation/list",
    "/v2/conversation/list"
  ];
  const DOUBAO_FEATURE_SELECTORS = [
    '[data-platform="doubao"]',
    ".doubao-chat",
    ".doubao-conversation",
    "#doubao-app",
    '[class*="doubao"]'
  ];
  class DoubaoAdapter extends BasePlatformAdapter {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "doubao");
      __publicField(this, "apiEndpoints", {
        detail: null,
        list: null,
        send: null,
        discovered: false
      });
      __publicField(this, "capturedConversations", /* @__PURE__ */ new Map());
      __publicField(this, "conversationMetas", /* @__PURE__ */ new Map());
    }
    /**
     * 检测当前页面是否属于 Doubao 平台
     * 
     * 检测策略：
     * 1. 检查 hostname
     * 2. 检查页面特征 DOM 元素
     * 3. 检查全局对象（如果有）
     */
    detect(options) {
      var _a;
      if (typeof window === "undefined") {
        return false;
      }
      const opts = {
        checkHostname: true,
        checkDomFeatures: true,
        hostnames: DOUBAO_HOSTNAMES,
        ...options
      };
      if (opts.checkHostname) {
        const hostname = window.location.hostname;
        const matchesHostname = (_a = opts.hostnames) == null ? void 0 : _a.some((pattern) => {
          if (pattern.startsWith("*.")) {
            return hostname.endsWith(pattern.slice(1));
          }
          return hostname === pattern;
        });
        if (matchesHostname) {
          console.log("[DoubaoAdapter] Detected by hostname:", hostname);
          return true;
        }
      }
      if (opts.checkDomFeatures) {
        const features = this.detectPlatformFeatures();
        if (features.hasFeatureElements || features.hasGlobalObject) {
          console.log("[DoubaoAdapter] Detected by platform features:", features);
          return true;
        }
      }
      return false;
    }
    /**
     * 获取单个对话的原始数据
     * 
     * 策略：
     * 1. 优先从已捕获的缓存中获取
     * 2. 如果未缓存，尝试通过 API 端点主动获取
     * 3. 支持从 URL 中提取 conversationId
     */
    async getConversation(conversationId) {
      console.log("[DoubaoAdapter] getConversation called", { conversationId });
      if (conversationId && this.capturedConversations.has(conversationId)) {
        const data = this.capturedConversations.get(conversationId);
        return {
          platform: this.platform,
          data
        };
      }
      const idFromUrl = this.extractConversationIdFromUrl();
      const targetId = conversationId || idFromUrl;
      if (!targetId) {
        console.warn("[DoubaoAdapter] No conversation ID available");
        return null;
      }
      try {
        const detail = await this.fetchConversationDetail(targetId);
        if (detail) {
          this.capturedConversations.set(targetId, detail);
          return {
            platform: this.platform,
            data: detail
          };
        }
      } catch (error) {
        console.error("[DoubaoAdapter] Failed to fetch conversation:", error);
      }
      return null;
    }
    /**
     * 获取对话列表的原始数据
     * 
     * 策略：
     * 1. 优先从已拦截的 API 响应中获取
     * 2. 尝试通过 API 端点主动获取
     * 3. 回退到从 DOM 中提取对话元数据
     */
    async listConversations() {
      console.log("[DoubaoAdapter] listConversations called");
      const metas = [];
      for (const [id, detail] of this.capturedConversations.entries()) {
        const title = detail.title || detail.sessionTitle || "Doubao Chat";
        const createTime = this.parseTimestamp(detail.createTime);
        metas.push({ id, title, createTime });
      }
      try {
        const listData = await this.fetchConversationList();
        if (listData && Array.isArray(listData)) {
          for (const item of listData) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            const createTime = this.parseTimestamp(item.createTime);
            if (id && !metas.some((m) => m.id === id)) {
              metas.push({ id, title, createTime });
            }
          }
        }
      } catch (error) {
        console.warn("[DoubaoAdapter] Failed to fetch conversation list:", error);
      }
      if (metas.length === 0) {
        const domMetas = this.extractConversationMetasFromDom();
        for (const meta of domMetas) {
          if (!metas.some((m) => m.id === meta.id)) {
            metas.push(meta);
          }
        }
      }
      return metas.map((meta) => ({
        platform: this.platform,
        data: {
          conversationId: meta.id,
          title: meta.title,
          createTime: meta.createTime
        }
      }));
    }
    /**
     * 提取消息列表
     * 
     * 将 Doubao 的 turns/messages/convs 数组转换为 RawMessage 数组
     */
    extractMessages(rawConversation) {
      console.log("[DoubaoAdapter] extractMessages called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[DoubaoAdapter] Invalid input to extractMessages");
        return [];
      }
      const data = rawConversation.data;
      const turns = data.data || data.messages || data.turns || data.convs || [];
      const sortedTurns = [...turns].sort((a, b) => {
        const indexA = a.index ?? 0;
        const indexB = b.index ?? 0;
        if (indexA !== indexB) return indexA - indexB;
        const timeA = this.parseTimestamp(a.createTime || a.timestamp) || 0;
        const timeB = this.parseTimestamp(b.createTime || b.timestamp) || 0;
        return timeA - timeB;
      });
      return sortedTurns.map((turn) => ({
        platform: this.platform,
        data: turn
      }));
    }
    /**
     * 获取平台元数据
     */
    async getMetadata() {
      const features = this.detectPlatformFeatures();
      return {
        platform: this.platform,
        detected: this.detect(),
        endpointsDiscovered: this.apiEndpoints.discovered,
        capturedCount: this.capturedConversations.size,
        platformFeatures: features
      };
    }
    // ============================================================================
    // 内部方法：平台特征检测
    // ============================================================================
    /**
     * 检测平台特征
     */
    detectPlatformFeatures() {
      var _a;
      if (typeof document === "undefined") {
        return {};
      }
      const features = {
        hostname: window.location.hostname,
        hasFeatureElements: false,
        featureSelectors: [],
        hasGlobalObject: false
      };
      for (const selector of DOUBAO_FEATURE_SELECTORS) {
        const element = document.querySelector(selector);
        if (element) {
          features.hasFeatureElements = true;
          (_a = features.featureSelectors) == null ? void 0 : _a.push(selector);
        }
      }
      const possibleGlobals = ["doubao", "DoubaoApp", "__DOUBAO__"];
      for (const name of possibleGlobals) {
        if (name in window) {
          features.hasGlobalObject = true;
          features.globalObjectName = name;
          break;
        }
      }
      return features;
    }
    // ============================================================================
    // 内部方法：API 端点探测
    // ============================================================================
    /**
     * 动态发现 API 端点
     * 
     * 策略：
     * 1. 从已拦截的请求中选择
     * 2. 从页面 JS 资源中提取
     * 3. 回退到常见端点探测
     */
    async discoverApiEndpoints() {
      if (this.apiEndpoints.discovered) {
        return this.apiEndpoints;
      }
      const endpoints = {
        detail: null,
        list: null,
        send: null,
        discovered: false
      };
      if (!endpoints.detail) {
        console.log("[DoubaoAdapter] Using fallback probe for detail API");
        endpoints.detail = await this.probeDetailApi();
      }
      if (!endpoints.list) {
        console.log("[DoubaoAdapter] Using fallback probe for list API");
        endpoints.list = await this.probeListApi();
      }
      console.log("[DoubaoAdapter] Discovered API endpoints:", endpoints);
      this.apiEndpoints = { ...endpoints, discovered: true };
      return this.apiEndpoints;
    }
    /**
     * 探测 detail API 端点
     */
    async probeDetailApi() {
      console.warn("[DoubaoAdapter] probeDetailApi not fully implemented");
      return DETAIL_ENDPOINT_CANDIDATES[0];
    }
    /**
     * 探测 list API 端点
     */
    async probeListApi() {
      console.warn("[DoubaoAdapter] probeListApi not fully implemented");
      return LIST_ENDPOINT_CANDIDATES[0];
    }
    // ============================================================================
    // 内部方法：数据获取
    // ============================================================================
    /**
     * 获取对话详情
     */
    async fetchConversationDetail(_conversationId) {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.detail) {
        throw new Error("Detail API endpoint not available");
      }
      console.warn("[DoubaoAdapter] fetchConversationDetail not fully implemented");
      return null;
    }
    /**
     * 获取对话列表
     */
    async fetchConversationList() {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.list) {
        throw new Error("List API endpoint not available");
      }
      console.warn("[DoubaoAdapter] fetchConversationList not fully implemented");
      return null;
    }
    // ============================================================================
    // 内部方法：数据提取辅助
    // ============================================================================
    /**
     * 从 URL 中提取 conversationId
     */
    extractConversationIdFromUrl() {
      if (typeof window === "undefined") {
        return "";
      }
      try {
        const url = new URL(window.location.href);
        return url.searchParams.get("conversationId") || url.searchParams.get("conversation_id") || url.searchParams.get("id") || url.searchParams.get("chatId") || url.searchParams.get("session_id") || this.extractIdFromPath();
      } catch {
        return this.extractIdFromPath();
      }
    }
    /**
     * 从路径中提取 conversationId
     */
    extractIdFromPath() {
      if (typeof window === "undefined") {
        return "";
      }
      const patterns = [
        /\/chat\/([^/?#]+)/,
        /\/conversation\/([^/?#]+)/,
        /\/c\/([^/?#]+)/,
        /\/d\/([^/?#]+)/,
        /\/s\/([^/?#]+)/
      ];
      for (const pattern of patterns) {
        const match = window.location.pathname.match(pattern);
        if (match) {
          return decodeURIComponent(match[1]);
        }
      }
      return "";
    }
    /**
     * 从对话项中提取 ID
     */
    extractConversationId(item) {
      return item.conversationId || item.conversation_id || item.convId || item.id || item.sessionId || item.chatId || "";
    }
    /**
     * 从对话项中提取标题
     */
    extractConversationTitle(item) {
      return item.title || item.sessionTitle || item.name || item.summary || item.firstMessage || "Doubao Chat";
    }
    /**
     * 解析时间戳
     */
    parseTimestamp(timestamp) {
      if (!timestamp) return void 0;
      if (typeof timestamp === "number") {
        return timestamp < 1e12 ? timestamp * 1e3 : timestamp;
      }
      const parsed = Date.parse(timestamp);
      return Number.isNaN(parsed) ? void 0 : parsed;
    }
    /**
     * 从 DOM 中提取对话元数据
     */
    extractConversationMetasFromDom() {
      if (typeof document === "undefined") {
        return [];
      }
      const metas = [];
      const seen = /* @__PURE__ */ new Set();
      const selectors = [
        'a[href*="/chat/"]',
        'a[href*="/conversation/"]',
        'a[href*="/c/"]',
        "[data-conversation-id]",
        "[data-chat-id]"
      ];
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const a = el;
          const href = a.getAttribute("href") || "";
          const patterns = [
            /\/chat\/([^/?#]+)/,
            /\/conversation\/([^/?#]+)/,
            /\/c\/([^/?#]+)/
          ];
          let id = "";
          for (const pattern of patterns) {
            const match = href.match(pattern);
            if (match) {
              id = decodeURIComponent(match[1]);
              break;
            }
          }
          if (!id) {
            id = a.getAttribute("data-conversation-id") || a.getAttribute("data-chat-id") || "";
          }
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const text = (a.textContent || "").trim();
          metas.push({
            id,
            title: text || "Doubao Chat"
          });
        }
      }
      return metas;
    }
    // ============================================================================
    // 内部方法：API 响应拦截（可选，L3 能力）
    // ============================================================================
    /**
     * 安装 API 响应拦截器
     * 
     * TODO: 此方法需要在合适的时机调用（如 userscript 初始化时）
     * 用于拦截 XMLHttpRequest 和 fetch 请求
     * 
     * 这是 L3 能力，建议在 L1/L2 稳定后再实现
     */
    installInterceptors() {
      if (typeof window === "undefined") {
        return;
      }
      console.log("[DoubaoAdapter] installInterceptors not fully implemented");
    }
    /**
     * 处理 Doubao 详情响应
     * 
     * TODO: 需要根据真实 API 响应结构调整
     */
    handleDoubaoResponse(text, _url) {
      var _a, _b, _c, _d, _e;
      try {
        const json = JSON.parse(text);
        let convsData = null;
        const jsonObj = json;
        if (Array.isArray(jsonObj.data) || Array.isArray(jsonObj.messages) || Array.isArray(jsonObj.turns) || Array.isArray(jsonObj.convs)) {
          convsData = json;
        } else if (Array.isArray((_a = jsonObj.data) == null ? void 0 : _a.data) || Array.isArray((_b = jsonObj.data) == null ? void 0 : _b.messages)) {
          convsData = jsonObj.data;
        } else if (Array.isArray((_c = jsonObj.result) == null ? void 0 : _c.data) || Array.isArray((_d = jsonObj.result) == null ? void 0 : _d.messages)) {
          convsData = jsonObj.result;
        } else if (Array.isArray((_e = jsonObj.response) == null ? void 0 : _e.data)) {
          convsData = jsonObj.response;
        }
        if (!convsData) {
          console.warn("[DoubaoAdapter] Could not extract conversation data from response");
          return;
        }
        const idFromUrl = this.extractConversationIdFromUrl();
        const title = convsData.title || convsData.sessionTitle || json.title || "Doubao Chat";
        const id = idFromUrl || this.generateConversationId(title);
        this.conversationMetas.set(id, { id, title });
        this.capturedConversations.set(id, convsData);
        console.log("[DoubaoAdapter] Captured conversation:", id);
      } catch (error) {
        console.error("[DoubaoAdapter] Failed to handle response:", error);
      }
    }
    /**
     * 处理 Doubao 列表响应
     */
    handleConversationListResponse(text) {
      try {
        const json = JSON.parse(text);
        const conversations = this.pickArray(json, ["conversations", "data", "result", "response", "payload"]) || this.pickArray(json.data || {}, [
          "conversations",
          "result",
          "response",
          "payload"
        ]) || [];
        if (conversations.length > 0) {
          for (const item of conversations) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id) {
              this.conversationMetas.set(id, { id, title });
            }
          }
        }
      } catch (error) {
        console.error("[DoubaoAdapter] Failed to handle list response:", error);
      }
    }
    /**
     * 从对象中 pick 第一个匹配的数组
     */
    pickArray(obj, candidates) {
      for (const key of candidates) {
        const val = obj == null ? void 0 : obj[key];
        if (Array.isArray(val)) return val;
      }
      return [];
    }
    /**
     * 生成对话 ID（当无法从响应中获取时）
     */
    generateConversationId(title) {
      const sanitized = String(title || "export").replace(/[\/\\?%*:|"<>]/g, "-").trim();
      return `${sanitized}_${Date.now()}`;
    }
  }
  const KIMI_DOMAINS = [
    "kimi.moonshot.cn",
    "kimi.ai"
  ];
  const KIMI_DETAIL_ENDPOINT_CANDIDATES = [
    "/api/chat/detail",
    "/api/conversation/detail",
    "/api/session/detail",
    "/api/v1/chat/detail",
    "/api/v1/conversation/detail",
    "/chat/detail",
    "/conversation/detail",
    "/graphql"
    // Kimi 可能使用 GraphQL
  ];
  const KIMI_LIST_ENDPOINT_CANDIDATES = [
    "/api/chat/list",
    "/api/conversation/list",
    "/api/session/list",
    "/api/v1/chat/list",
    "/api/v1/conversation/list",
    "/chat/list",
    "/conversation/list",
    "/graphql"
    // Kimi 可能使用 GraphQL
  ];
  const KIMI_URL_PATTERNS = [
    /^\/chat\/([a-zA-Z0-9-]+)$/i,
    // /chat/{id}
    /^\/conversation\/([a-zA-Z0-9-]+)$/i,
    // /conversation/{id}
    /^\/session\/([a-zA-Z0-9-]+)$/i,
    // /session/{id}
    /^\/c\/([a-zA-Z0-9-]+)$/i
    // /c/{id}
  ];
  const KIMI_CAPABILITY_LEVELS = {
    L1: "从当前页面 DOM 提取可见消息（基础）"
  };
  class KimiAdapter extends BasePlatformAdapter {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "kimi");
      __publicField(this, "apiEndpoints", {
        detail: null,
        list: null,
        discovered: false
      });
      __publicField(this, "capturedConversations", /* @__PURE__ */ new Map());
      __publicField(this, "conversationMetas", /* @__PURE__ */ new Map());
    }
    /**
     * 检测当前页面是否属于 Kimi 平台
     * 
     * 检测逻辑：
     * 1. 检查域名是否为 kimi.moonshot.cn 或 kimi.ai
     * 2. 检查页面特征（可选，待实现）
     * 
     * @returns 是否为 Kimi 平台
     */
    detect() {
      if (typeof window === "undefined") {
        return false;
      }
      const hostname = window.location.hostname;
      if (KIMI_DOMAINS.includes(hostname)) {
        return true;
      }
      if (hostname.endsWith(".moonshot.cn") || hostname.endsWith(".kimi.ai")) {
        return true;
      }
      return false;
    }
    /**
     * 获取单个对话的原始数据
     * 
     * 策略：
     * 1. 优先从已捕获的缓存中获取
     * 2. 如果未缓存，尝试通过 API 端点主动获取
     * 3. 支持从 URL 中提取 conversationId
     * 
     * @param conversationId 对话 ID（可选）
     * @returns 原始对话数据，失败时返回 null
     */
    async getConversation(conversationId) {
      console.log("[KimiAdapter] getConversation called", { conversationId });
      if (conversationId && this.capturedConversations.has(conversationId)) {
        const data = this.capturedConversations.get(conversationId);
        return {
          platform: this.platform,
          data
        };
      }
      const idFromUrl = this.extractConversationIdFromUrl();
      const targetId = conversationId || idFromUrl;
      if (!targetId) {
        console.warn("[KimiAdapter] No conversation ID available");
        return null;
      }
      try {
        const detail = await this.fetchConversationDetail(targetId);
        if (detail) {
          this.capturedConversations.set(targetId, detail);
          return {
            platform: this.platform,
            data: detail
          };
        }
      } catch (error) {
        console.error("[KimiAdapter] Failed to fetch conversation:", error);
      }
      console.warn("[KimiAdapter] Falling back to DOM extraction (not implemented)");
      return null;
    }
    /**
     * 获取对话列表的原始数据
     * 
     * 策略：
     * 1. 优先从已拦截的 API 响应中获取
     * 2. 尝试通过 API 端点主动获取
     * 3. 回退到从 DOM 中提取对话元数据
     * 
     * @returns 原始对话列表
     */
    async listConversations() {
      var _a, _b, _c;
      console.log("[KimiAdapter] listConversations called");
      const metas = [];
      for (const [id, detail] of this.capturedConversations.entries()) {
        const title = detail.title || ((_a = detail.metadata) == null ? void 0 : _a.title) || "Kimi Chat";
        metas.push({
          id,
          title,
          createTime: detail.create_time,
          updateTime: detail.update_time,
          model: (_b = detail.metadata) == null ? void 0 : _b.model,
          messageCount: (_c = detail.messages) == null ? void 0 : _c.length
        });
      }
      try {
        const listData = await this.fetchConversationList();
        if (listData && Array.isArray(listData)) {
          for (const item of listData) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id && !metas.some((m) => m.id === id)) {
              metas.push({
                id,
                title,
                createTime: item.create_time,
                updateTime: item.update_time,
                model: item.model,
                messageCount: item.message_count
              });
            }
          }
        }
      } catch (error) {
        console.warn("[KimiAdapter] Failed to fetch conversation list:", error);
      }
      if (metas.length === 0) {
        const domMetas = this.extractConversationMetasFromDom();
        for (const meta of domMetas) {
          if (!metas.some((m) => m.id === meta.id)) {
            metas.push(meta);
          }
        }
      }
      return metas.map((meta) => ({
        platform: this.platform,
        data: {
          conversationId: meta.id,
          title: meta.title,
          create_time: meta.createTime,
          update_time: meta.updateTime,
          model: meta.model,
          message_count: meta.messageCount
        }
      }));
    }
    /**
     * 提取消息列表
     * 
     * 将 Kimi 的 messages/chats/turns 数组转换为 RawMessage 数组
     * 
     * @param rawConversation 原始对话数据
     * @returns 原始消息列表
     */
    extractMessages(rawConversation) {
      console.log("[KimiAdapter] extractMessages called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[KimiAdapter] Invalid input to extractMessages");
        return [];
      }
      const data = rawConversation.data;
      let messages = [];
      if (Array.isArray(data.messages)) {
        messages = data.messages;
      } else if (Array.isArray(data.chats)) {
        messages = data.chats;
      } else if (Array.isArray(data.turns)) {
        messages = data.turns;
      } else if (data.mapping) {
        messages = this.extractMessagesFromMapping(data.mapping);
      }
      return messages.map((msg) => ({
        platform: this.platform,
        data: msg
      }));
    }
    /**
     * 获取平台元数据
     * 
     * @returns 平台元数据
     */
    async getMetadata() {
      return {
        platform: this.platform,
        detected: this.detect(),
        endpointsDiscovered: this.apiEndpoints.discovered,
        capturedCount: this.capturedConversations.size,
        metaCount: this.conversationMetas.size,
        capabilityLevel: "L1",
        // 当前实现级别
        capabilityDescription: KIMI_CAPABILITY_LEVELS.L1
      };
    }
    // ============================================================================
    // 内部方法：API 端点探测
    // ============================================================================
    /**
     * 动态发现 API 端点
     * 
     * 策略：
     * 1. 从已拦截的请求中选择
     * 2. 从页面 JS 资源中提取
     * 3. 回退到常见端点探测
     * 
     * @returns 发现的 API 端点
     */
    async discoverApiEndpoints() {
      if (this.apiEndpoints.discovered) {
        return this.apiEndpoints;
      }
      const endpoints = {
        detail: null,
        list: null,
        discovered: false
      };
      if (!endpoints.detail) {
        console.log("[KimiAdapter] Using fallback probe for detail API");
        endpoints.detail = await this.probeDetailApi();
      }
      if (!endpoints.list) {
        console.log("[KimiAdapter] Using fallback probe for list API");
        endpoints.list = await this.probeListApi();
      }
      console.log("[KimiAdapter] Discovered API endpoints:", endpoints);
      this.apiEndpoints = { ...endpoints, discovered: true };
      return this.apiEndpoints;
    }
    /**
     * 探测 detail API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     * 可能的策略：
     * 1. 发送 OPTIONS 请求探测端点
     * 2. 从页面 JS 文件中提取 API 路径
     * 3. 监听网络请求并识别模式
     */
    async probeDetailApi() {
      console.warn("[KimiAdapter] probeDetailApi not fully implemented");
      return KIMI_DETAIL_ENDPOINT_CANDIDATES[0];
    }
    /**
     * 探测 list API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     */
    async probeListApi() {
      console.warn("[KimiAdapter] probeListApi not fully implemented");
      return KIMI_LIST_ENDPOINT_CANDIDATES[0];
    }
    // ============================================================================
    // 内部方法：数据获取
    // ============================================================================
    /**
     * 获取对话详情
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     * 需要：
     * 1. 确定正确的 API 端点
     * 2. 确定认证方式（Cookie / Token）
     * 3. 确定请求参数格式
     */
    async fetchConversationDetail(_conversationId) {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.detail) {
        throw new Error("Detail API endpoint not available");
      }
      console.warn("[KimiAdapter] fetchConversationDetail not fully implemented");
      return null;
    }
    /**
     * 获取对话列表
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     */
    async fetchConversationList() {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.list) {
        throw new Error("List API endpoint not available");
      }
      console.warn("[KimiAdapter] fetchConversationList not fully implemented");
      return null;
    }
    // ============================================================================
    // 内部方法：数据提取辅助
    // ============================================================================
    /**
     * 从 URL 中提取 conversationId
     * 
     * Kimi 的 URL 模式可能是：
     * - https://kimi.moonshot.cn/chat/{conversation-id}
     * - https://kimi.moonshot.cn/conversation/{conversation-id}
     * 
     * TODO: 需要实际访问 Kimi 网页版验证 URL 结构
     */
    extractConversationIdFromUrl() {
      if (typeof window === "undefined") {
        return "";
      }
      try {
        const url = new URL(window.location.href);
        const pathname = url.pathname;
        for (const pattern of KIMI_URL_PATTERNS) {
          const match = pathname.match(pattern);
          if (match && match[1]) {
            return match[1];
          }
        }
        return url.searchParams.get("conversationId") || url.searchParams.get("conversation_id") || url.searchParams.get("chatId") || url.searchParams.get("chat_id") || url.searchParams.get("sessionId") || url.searchParams.get("session_id") || url.searchParams.get("id") || "";
      } catch {
        return "";
      }
    }
    /**
     * 从对话项中提取 ID
     * 
     * 支持多种可能的字段名
     */
    extractConversationId(item) {
      return item.conversation_id || item.conversationId || item.chat_id || item.chatId || item.session_id || item.sessionId || item.id || "";
    }
    /**
     * 从对话项中提取标题
     * 
     * 支持多种可能的字段名
     */
    extractConversationTitle(item) {
      return item.title || item.conversationTitle || item.chatTitle || item.name || item.summary || item.topic || "Kimi Chat";
    }
    /**
     * 从 DOM 中提取对话元数据
     * 
     * TODO: 需要根据 Kimi 的实际 DOM 结构实现
     * 需要：
     * 1. 访问 Kimi 网页版
     * 2. 检查对话列表的 HTML 结构
     * 3. 确定正确的选择器
     */
    extractConversationMetasFromDom() {
      if (typeof document === "undefined") {
        return [];
      }
      const metas = [];
      const seen = /* @__PURE__ */ new Set();
      const links = document.querySelectorAll('a[href*="/chat/"], a[href*="/conversation/"]');
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        for (const pattern of KIMI_URL_PATTERNS) {
          const match = href.match(pattern);
          if (!match || !match[1]) continue;
          const id = match[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const text = (a.textContent || "").trim();
          metas.push({
            id,
            title: text || "Kimi Chat"
          });
          break;
        }
      }
      return metas;
    }
    /**
     * 从 mapping 结构中提取消息
     * 
     * 如果 Kimi 使用树状 mapping 结构来组织消息
     */
    extractMessagesFromMapping(mapping) {
      const messages = [];
      for (const key of Object.keys(mapping)) {
        const node = mapping[key];
        if (node == null ? void 0 : node.message) {
          messages.push(node.message);
        }
      }
      return messages;
    }
    // ============================================================================
    // 内部方法：API 响应拦截（可选）
    // ============================================================================
    /**
     * 安装 API 响应拦截器
     * 
     * TODO: 此方法需要在合适的时机调用（如 userscript 初始化时）
     * 用于拦截 XMLHttpRequest 和 fetch 请求
     * 
     * 需要实现：
     * 1. 拦截 XHR 请求
     * 2. 拦截 fetch 请求
     * 3. 识别 Kimi 相关的 API 响应
     * 4. 解析并缓存响应数据
     */
    installInterceptors() {
      if (typeof window === "undefined") {
        return;
      }
      console.log("[KimiAdapter] installInterceptors not fully implemented");
    }
    /**
     * 处理 Kimi 详情响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleKimiResponse(text, _url) {
      var _a, _b, _c, _d;
      try {
        const json = JSON.parse(text);
        let convData = null;
        if (Array.isArray(json.messages)) {
          convData = json;
        } else if (Array.isArray(json.chats)) {
          convData = json;
        } else if (Array.isArray(json.turns)) {
          convData = json;
        } else if (json.mapping) {
          convData = json;
        } else if (Array.isArray((_a = json == null ? void 0 : json.data) == null ? void 0 : _a.messages)) {
          convData = json.data;
        } else if (Array.isArray((_b = json == null ? void 0 : json.result) == null ? void 0 : _b.messages)) {
          convData = json.result;
        } else if (Array.isArray((_c = json == null ? void 0 : json.response) == null ? void 0 : _c.messages)) {
          convData = json.response;
        }
        if (!convData) return;
        const idFromUrl = this.extractConversationIdFromUrl();
        const id = idFromUrl || json.id || json.conversation_id || json.chat_id || `${Date.now()}`;
        const title = json.title || ((_d = json.metadata) == null ? void 0 : _d.title) || "Kimi Chat";
        this.conversationMetas.set(id, { id, title });
        this.capturedConversations.set(id, convData);
        console.log("[KimiAdapter] Captured conversation:", id);
      } catch (error) {
        console.error("[KimiAdapter] Failed to handle response:", error);
      }
    }
    /**
     * 处理 Kimi 列表响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleConversationListResponse(text) {
      var _a;
      try {
        const json = JSON.parse(text);
        const items = json.items || json.conversation_items || json.chats || json.sessions || (Array.isArray(json.data) ? json.data : (_a = json.data) == null ? void 0 : _a.items) || json.result || [];
        const conversations = Array.isArray(items) ? items : [];
        if (conversations.length > 0) {
          for (const item of conversations) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id) {
              this.conversationMetas.set(id, {
                id,
                title,
                createTime: item.create_time,
                updateTime: item.update_time,
                model: item.model,
                messageCount: item.message_count
              });
            }
          }
        }
      } catch (error) {
        console.error("[KimiAdapter] Failed to handle list response:", error);
      }
    }
  }
  const CLAUDE_DOMAINS = [
    "claude.ai",
    "www.claude.ai"
  ];
  const CLAUDE_DETAIL_ENDPOINT_CANDIDATES = [
    "/api/organizations",
    "/api/organizations/:organizationId/projets/:projectId/chats/:chatId",
    "/api/shared_chats/:chatId",
    "/api/chats/:chatId",
    "/api/conversations/:conversationId"
  ];
  const CLAUDE_LIST_ENDPOINT_CANDIDATES = [
    "/api/organizations/:organizationId/chats",
    "/api/organizations/:organizationId/projets/:projectId/chats",
    "/api/chats",
    "/api/conversations"
  ];
  const CLAUDE_URL_PATTERNS = [
    /^\/chat\/([a-f0-9-]+)$/i,
    // /chat/{chat-id}
    /^\/c\/([a-f0-9-]+)$/i,
    // /c/{chat-id}
    /^\/conversation\/([a-f0-9-]+)$/i,
    // /conversation/{chat-id}
    /^\/shared\/([a-f0-9-]+)$/i
    // /shared/{chat-id} (共享对话)
  ];
  const CLAUDE_CAPABILITY_LEVELS = {
    L1: "从当前页面 DOM 提取可见消息（基础）"
  };
  class ClaudeAdapter extends BasePlatformAdapter {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "claude");
      __publicField(this, "apiEndpoints", {
        detail: null,
        list: null,
        discovered: false
      });
      __publicField(this, "capturedConversations", /* @__PURE__ */ new Map());
      __publicField(this, "conversationMetas", /* @__PURE__ */ new Map());
    }
    /**
     * 检测当前页面是否属于 Claude 平台
     * 
     * 检测逻辑：
     * 1. 检查域名是否为 claude.ai
     * 2. 检查页面特征（可选，待实现）
     * 
     * @returns 是否为 Claude 平台
     */
    detect() {
      if (typeof window === "undefined") {
        return false;
      }
      const hostname = window.location.hostname;
      if (CLAUDE_DOMAINS.includes(hostname)) {
        return true;
      }
      if (hostname.endsWith(".claude.ai")) {
        return true;
      }
      return false;
    }
    /**
     * 获取单个对话的原始数据
     * 
     * 策略：
     * 1. 优先从已捕获的缓存中获取
     * 2. 如果未缓存，尝试通过 API 端点主动获取
     * 3. 支持从 URL 中提取 conversationId
     * 
     * @param conversationId 对话 ID（可选）
     * @returns 原始对话数据，失败时返回 null
     */
    async getConversation(conversationId) {
      console.log("[ClaudeAdapter] getConversation called", { conversationId });
      if (conversationId && this.capturedConversations.has(conversationId)) {
        const data = this.capturedConversations.get(conversationId);
        return {
          platform: this.platform,
          data
        };
      }
      const idFromUrl = this.extractConversationIdFromUrl();
      const targetId = conversationId || idFromUrl;
      if (!targetId) {
        console.warn("[ClaudeAdapter] No conversation ID available");
        return null;
      }
      try {
        const detail = await this.fetchConversationDetail(targetId);
        if (detail) {
          this.capturedConversations.set(targetId, detail);
          return {
            platform: this.platform,
            data: detail
          };
        }
      } catch (error) {
        console.error("[ClaudeAdapter] Failed to fetch conversation:", error);
      }
      console.warn("[ClaudeAdapter] Falling back to DOM extraction (not implemented)");
      return null;
    }
    /**
     * 获取对话列表的原始数据
     * 
     * 策略：
     * 1. 优先从已拦截的 API 响应中获取
     * 2. 尝试通过 API 端点主动获取
     * 3. 回退到从 DOM 中提取对话元数据
     * 
     * @returns 原始对话列表
     */
    async listConversations() {
      var _a, _b, _c, _d;
      console.log("[ClaudeAdapter] listConversations called");
      const metas = [];
      for (const [id, detail] of this.capturedConversations.entries()) {
        const title = detail.title || ((_a = detail.metadata) == null ? void 0 : _a.title) || "Claude Chat";
        metas.push({
          id,
          title,
          createTime: this.parseTimestamp(detail.created_at || Date.now()),
          updateTime: this.parseTimestamp(detail.updated_at || Date.now()),
          model: (_b = detail.metadata) == null ? void 0 : _b.model,
          projectUuid: detail.project_uuid || ((_c = detail.metadata) == null ? void 0 : _c.project_uuid),
          organizationUuid: detail.organization_uuid || ((_d = detail.metadata) == null ? void 0 : _d.organization_uuid)
        });
      }
      try {
        const listData = await this.fetchConversationList();
        if (listData && Array.isArray(listData)) {
          for (const item of listData) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id && !metas.some((m) => m.id === id)) {
              metas.push({
                id,
                title,
                createTime: this.parseTimestamp(item.created_at || Date.now()),
                updateTime: this.parseTimestamp(item.updated_at || Date.now()),
                model: void 0,
                // Claude 列表项通常不包含 model 信息
                projectUuid: item.project_uuid,
                organizationUuid: item.organization_uuid
              });
            }
          }
        }
      } catch (error) {
        console.warn("[ClaudeAdapter] Failed to fetch conversation list:", error);
      }
      if (metas.length === 0) {
        const domMetas = this.extractConversationMetasFromDom();
        for (const meta of domMetas) {
          if (!metas.some((m) => m.id === meta.id)) {
            metas.push(meta);
          }
        }
      }
      return metas.map((meta) => ({
        platform: this.platform,
        data: {
          conversationId: meta.id,
          title: meta.title,
          created_at: meta.createTime,
          updated_at: meta.updateTime,
          project_uuid: meta.projectUuid,
          organization_uuid: meta.organizationUuid
        }
      }));
    }
    /**
     * 提取消息列表
     * 
     * 将 Claude 的 messages/turns/chat_history 数组转换为 RawMessage 数组
     * 
     * @param rawConversation 原始对话数据
     * @returns 原始消息列表
     */
    extractMessages(rawConversation) {
      var _a, _b;
      console.log("[ClaudeAdapter] extractMessages called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[ClaudeAdapter] Invalid input to extractMessages");
        return [];
      }
      const data = rawConversation.data;
      let messages = [];
      if (Array.isArray(data.messages)) {
        messages = data.messages;
      } else if (Array.isArray(data.turns)) {
        messages = data.turns;
      } else if (Array.isArray(data.chat_history)) {
        messages = data.chat_history;
      } else if ((_a = data.chat) == null ? void 0 : _a.messages) {
        messages = data.chat.messages;
      } else if ((_b = data.conversation) == null ? void 0 : _b.messages) {
        messages = data.conversation.messages;
      }
      return messages.map((msg) => ({
        platform: this.platform,
        data: msg
      }));
    }
    /**
     * 获取平台元数据
     * 
     * @returns 平台元数据
     */
    async getMetadata() {
      return {
        platform: this.platform,
        detected: this.detect(),
        endpointsDiscovered: this.apiEndpoints.discovered,
        capturedCount: this.capturedConversations.size,
        metaCount: this.conversationMetas.size,
        capabilityLevel: "L1",
        // 当前实现级别
        capabilityDescription: CLAUDE_CAPABILITY_LEVELS.L1
      };
    }
    // ============================================================================
    // 内部方法：API 端点探测
    // ============================================================================
    /**
     * 动态发现 API 端点
     * 
     * 策略：
     * 1. 从已拦截的请求中选择
     * 2. 从页面 JS 资源中提取
     * 3. 回退到常见端点探测
     * 
     * @returns 发现的 API 端点
     */
    async discoverApiEndpoints() {
      if (this.apiEndpoints.discovered) {
        return this.apiEndpoints;
      }
      const endpoints = {
        detail: null,
        list: null,
        discovered: false
      };
      if (!endpoints.detail) {
        console.log("[ClaudeAdapter] Using fallback probe for detail API");
        endpoints.detail = await this.probeDetailApi();
      }
      if (!endpoints.list) {
        console.log("[ClaudeAdapter] Using fallback probe for list API");
        endpoints.list = await this.probeListApi();
      }
      console.log("[ClaudeAdapter] Discovered API endpoints:", endpoints);
      this.apiEndpoints = { ...endpoints, discovered: true };
      return this.apiEndpoints;
    }
    /**
     * 探测 detail API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     * 可能的策略：
     * 1. 发送 OPTIONS 请求探测端点
     * 2. 从页面 JS 文件中提取 API 路径
     * 3. 监听网络请求并识别模式
     */
    async probeDetailApi() {
      console.warn("[ClaudeAdapter] probeDetailApi not fully implemented");
      return CLAUDE_DETAIL_ENDPOINT_CANDIDATES[0];
    }
    /**
     * 探测 list API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     */
    async probeListApi() {
      console.warn("[ClaudeAdapter] probeListApi not fully implemented");
      return CLAUDE_LIST_ENDPOINT_CANDIDATES[0];
    }
    // ============================================================================
    // 内部方法：数据获取
    // ============================================================================
    /**
     * 获取对话详情
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     * 需要：
     * 1. 确定正确的 API 端点
     * 2. 确定认证方式（Cookie / Token）
     * 3. 确定请求参数格式
     */
    async fetchConversationDetail(_conversationId) {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.detail) {
        throw new Error("Detail API endpoint not available");
      }
      console.warn("[ClaudeAdapter] fetchConversationDetail not fully implemented");
      return null;
    }
    /**
     * 获取对话列表
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     */
    async fetchConversationList() {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.list) {
        throw new Error("List API endpoint not available");
      }
      console.warn("[ClaudeAdapter] fetchConversationList not fully implemented");
      return null;
    }
    // ============================================================================
    // 内部方法：数据提取辅助
    // ============================================================================
    /**
     * 从 URL 中提取 conversationId
     * 
     * Claude 的 URL 模式可能是：
     * - https://claude.ai/chat/{chat-id}
     * - https://claude.ai/c/{chat-id}
     * - https://claude.ai/shared/{chat-id} (共享对话)
     * 
     * TODO: 需要实际访问 Claude 网页版验证 URL 结构
     */
    extractConversationIdFromUrl() {
      if (typeof window === "undefined") {
        return "";
      }
      try {
        const url = new URL(window.location.href);
        const pathname = url.pathname;
        for (const pattern of CLAUDE_URL_PATTERNS) {
          const match = pathname.match(pattern);
          if (match && match[1]) {
            return match[1];
          }
        }
        return url.searchParams.get("conversationId") || url.searchParams.get("conversation_id") || url.searchParams.get("chatId") || url.searchParams.get("chat_id") || url.searchParams.get("sessionId") || url.searchParams.get("session_id") || url.searchParams.get("id") || "";
      } catch {
        return "";
      }
    }
    /**
     * 辅助方法：解析时间戳
     * @param timestamp 各种格式的时间戳
     */
    parseTimestamp(timestamp) {
      if (typeof timestamp === "number") {
        return timestamp < 1e12 ? timestamp * 1e3 : timestamp;
      }
      return new Date(timestamp).getTime();
    }
    /**
     * 从对话项中提取 ID
     * 
     * 支持多种可能的字段名
     */
    extractConversationId(item) {
      return item.conversation_id || item.conversationId || item.chat_id || item.chatId || item.session_id || item.sessionId || item.uuid || item.id || "";
    }
    /**
     * 从对话项中提取标题
     * 
     * 支持多种可能的字段名
     */
    extractConversationTitle(item) {
      return item.title || item.conversationTitle || item.chatTitle || item.name || item.summary || item.topic || "Claude Chat";
    }
    /**
     * 从 DOM 中提取对话元数据
     * 
     * TODO: 需要根据 Claude 的实际 DOM 结构实现
     * 需要：
     * 1. 访问 Claude 网页版
     * 2. 检查对话列表的 HTML 结构
     * 3. 确定正确的选择器
     */
    extractConversationMetasFromDom() {
      if (typeof document === "undefined") {
        return [];
      }
      const metas = [];
      const seen = /* @__PURE__ */ new Set();
      const links = document.querySelectorAll('a[href*="/chat/"], a[href*="/c/"]');
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        for (const pattern of CLAUDE_URL_PATTERNS) {
          const match = href.match(pattern);
          if (!match || !match[1]) continue;
          const id = match[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const text = (a.textContent || "").trim();
          metas.push({
            id,
            title: text || "Claude Chat"
          });
          break;
        }
      }
      return metas;
    }
    // ============================================================================
    // 内部方法：API 响应拦截（可选）
    // ============================================================================
    /**
     * 安装 API 响应拦截器
     * 
     * TODO: 此方法需要在合适的时机调用（如 userscript 初始化时）
     * 用于拦截 XMLHttpRequest 和 fetch 请求
     * 
     * 需要实现：
     * 1. 拦截 XHR 请求
     * 2. 拦截 fetch 请求
     * 3. 识别 Claude 相关的 API 响应
     * 4. 解析并缓存响应数据
     */
    installInterceptors() {
      if (typeof window === "undefined") {
        return;
      }
      console.log("[ClaudeAdapter] installInterceptors not fully implemented");
    }
    /**
     * 处理 Claude 详情响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleClaudeResponse(text, _url) {
      var _a, _b, _c, _d, _e;
      try {
        const json = JSON.parse(text);
        let convData = null;
        if (Array.isArray(json.messages)) {
          convData = json;
        } else if (Array.isArray(json.turns)) {
          convData = json;
        } else if (Array.isArray(json.chat_history)) {
          convData = json;
        } else if ((_a = json.chat) == null ? void 0 : _a.messages) {
          convData = json.chat;
        } else if ((_b = json.conversation) == null ? void 0 : _b.messages) {
          convData = json.conversation;
        } else if (Array.isArray((_c = json == null ? void 0 : json.data) == null ? void 0 : _c.messages)) {
          convData = json.data;
        } else if (Array.isArray((_d = json == null ? void 0 : json.result) == null ? void 0 : _d.messages)) {
          convData = json.result;
        }
        if (!convData) return;
        const idFromUrl = this.extractConversationIdFromUrl();
        const id = idFromUrl || json.uuid || json.id || json.conversation_id || json.chat_id || `${Date.now()}`;
        const title = json.title || ((_e = json.metadata) == null ? void 0 : _e.title) || "Claude Chat";
        this.conversationMetas.set(id, { id, title });
        this.capturedConversations.set(id, convData);
        console.log("[ClaudeAdapter] Captured conversation:", id);
      } catch (error) {
        console.error("[ClaudeAdapter] Failed to handle response:", error);
      }
    }
    /**
     * 处理 Claude 列表响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleConversationListResponse(text) {
      var _a;
      try {
        const json = JSON.parse(text);
        const items = json.chats || json.conversations || json.items || json.chat_items || (Array.isArray(json.data) ? json.data : (_a = json.data) == null ? void 0 : _a.items) || json.result || [];
        const conversations = Array.isArray(items) ? items : [];
        if (conversations.length > 0) {
          for (const item of conversations) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id) {
              this.conversationMetas.set(id, {
                id,
                title,
                createTime: this.parseTimestamp(item.created_at || Date.now()),
                updateTime: this.parseTimestamp(item.updated_at || Date.now()),
                projectUuid: item.project_uuid,
                organizationUuid: item.organization_uuid
              });
            }
          }
        }
      } catch (error) {
        console.error("[ClaudeAdapter] Failed to handle list response:", error);
      }
    }
  }
  const DEEPSEEK_DOMAINS = [
    "chat.deepseek.com",
    "www.deepseek.com",
    "deepseek.com",
    "chat.deepseek.ai"
  ];
  const DEEPSEEK_DETAIL_ENDPOINT_CANDIDATES = [
    "/api/chat/detail",
    "/api/conversation/detail",
    "/api/session/detail",
    "/api/v1/chat/detail",
    "/api/v1/conversation/detail",
    "/chat/detail",
    "/conversation/detail",
    "/graphql"
    // DeepSeek 可能使用 GraphQL
  ];
  const DEEPSEEK_LIST_ENDPOINT_CANDIDATES = [
    "/api/chat/list",
    "/api/conversation/list",
    "/api/session/list",
    "/api/v1/chat/list",
    "/api/v1/conversation/list",
    "/chat/list",
    "/conversation/list",
    "/graphql"
    // DeepSeek 可能使用 GraphQL
  ];
  const DEEPSEEK_URL_PATTERNS = [
    /^\/chat\/([a-zA-Z0-9-]+)$/i,
    // /chat/{id}
    /^\/conversation\/([a-zA-Z0-9-]+)$/i,
    // /conversation/{id}
    /^\/session\/([a-zA-Z0-9-]+)$/i,
    // /session/{id}
    /^\/c\/([a-zA-Z0-9-]+)$/i,
    // /c/{id}
    /^\/s\/([a-zA-Z0-9-]+)$/i
    // /s/{id}
  ];
  const DEEPSEEK_CAPABILITY_LEVELS = {
    L1: "从当前页面 DOM 提取可见消息（基础）"
  };
  const DEEPSEEK_FEATURE_SELECTORS = [
    '[data-platform="deepseek"]',
    ".deepseek-chat",
    ".deepseek-conversation",
    "#deepseek-app",
    '[class*="deepseek"]'
  ];
  class DeepSeekAdapter extends BasePlatformAdapter {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "deepseek");
      __publicField(this, "apiEndpoints", {
        detail: null,
        list: null,
        send: null,
        discovered: false
      });
      __publicField(this, "capturedConversations", /* @__PURE__ */ new Map());
      __publicField(this, "conversationMetas", /* @__PURE__ */ new Map());
    }
    /**
     * 检测当前页面是否属于 DeepSeek 平台
     * 
     * 检测策略：
     * 1. 检查 hostname 是否为 deepseek.com 相关域名
     * 2. 检查页面特征 DOM 元素（可选）
     * 3. 检查全局对象（如果有）
     * 
     * @returns 是否为 DeepSeek 平台
     */
    detect(options) {
      var _a;
      if (typeof window === "undefined") {
        return false;
      }
      const opts = {
        checkHostname: true,
        checkDomFeatures: true,
        hostnames: DEEPSEEK_DOMAINS,
        ...options
      };
      if (opts.checkHostname) {
        const hostname = window.location.hostname;
        const matchesHostname = (_a = opts.hostnames) == null ? void 0 : _a.some((pattern) => {
          if (pattern.startsWith("*.")) {
            return hostname.endsWith(pattern.slice(1));
          }
          return hostname === pattern;
        });
        if (matchesHostname) {
          console.log("[DeepSeekAdapter] Detected by hostname:", hostname);
          return true;
        }
        if (hostname.endsWith(".deepseek.com") || hostname.endsWith(".deepseek.ai")) {
          console.log("[DeepSeekAdapter] Detected by subdomain:", hostname);
          return true;
        }
      }
      if (opts.checkDomFeatures) {
        const features = this.detectPlatformFeatures();
        if (features.hasFeatureElements || features.hasGlobalObject) {
          console.log("[DeepSeekAdapter] Detected by platform features:", features);
          return true;
        }
      }
      return false;
    }
    /**
     * 获取单个对话的原始数据
     * 
     * 策略：
     * 1. 优先从已捕获的缓存中获取
     * 2. 如果未缓存，尝试通过 API 端点主动获取
     * 3. 支持从 URL 中提取 conversationId
     * 
     * @param conversationId 对话 ID（可选）
     * @returns 原始对话数据，失败时返回 null
     */
    async getConversation(conversationId) {
      console.log("[DeepSeekAdapter] getConversation called", { conversationId });
      if (conversationId && this.capturedConversations.has(conversationId)) {
        const data = this.capturedConversations.get(conversationId);
        return {
          platform: this.platform,
          data
        };
      }
      const idFromUrl = this.extractConversationIdFromUrl();
      const targetId = conversationId || idFromUrl;
      if (!targetId) {
        console.warn("[DeepSeekAdapter] No conversation ID available");
        return null;
      }
      try {
        const detail = await this.fetchConversationDetail(targetId);
        if (detail) {
          this.capturedConversations.set(targetId, detail);
          return {
            platform: this.platform,
            data: detail
          };
        }
      } catch (error) {
        console.error("[DeepSeekAdapter] Failed to fetch conversation:", error);
      }
      console.warn("[DeepSeekAdapter] Falling back to DOM extraction (not implemented)");
      return null;
    }
    /**
     * 获取对话列表的原始数据
     * 
     * 策略：
     * 1. 优先从已拦截的 API 响应中获取
     * 2. 尝试通过 API 端点主动获取
     * 3. 回退到从 DOM 中提取对话元数据
     * 
     * @returns 原始对话列表
     */
    async listConversations() {
      var _a, _b, _c;
      console.log("[DeepSeekAdapter] listConversations called");
      const metas = [];
      for (const [id, detail] of this.capturedConversations.entries()) {
        const title = detail.title || ((_a = detail.metadata) == null ? void 0 : _a.title) || "DeepSeek Chat";
        metas.push({
          id,
          title,
          createTime: detail.created_at,
          updateTime: detail.updated_at,
          model: detail.model || ((_b = detail.metadata) == null ? void 0 : _b.model),
          messageCount: (_c = detail.messages) == null ? void 0 : _c.length
        });
      }
      try {
        const listData = await this.fetchConversationList();
        if (listData && Array.isArray(listData)) {
          for (const item of listData) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id && !metas.some((m) => m.id === id)) {
              metas.push({
                id,
                title,
                createTime: item.created_at,
                updateTime: item.updated_at,
                model: item.model,
                messageCount: item.message_count
              });
            }
          }
        }
      } catch (error) {
        console.warn("[DeepSeekAdapter] Failed to fetch conversation list:", error);
      }
      if (metas.length === 0) {
        const domMetas = this.extractConversationMetasFromDom();
        for (const meta of domMetas) {
          if (!metas.some((m) => m.id === meta.id)) {
            metas.push(meta);
          }
        }
      }
      return metas.map((meta) => ({
        platform: this.platform,
        data: {
          conversationId: meta.id,
          title: meta.title,
          created_at: meta.createTime,
          updated_at: meta.updateTime,
          model: meta.model,
          message_count: meta.messageCount
        }
      }));
    }
    /**
     * 提取消息列表
     * 
     * 将 DeepSeek 的 messages/chats/turns 数组转换为 RawMessage 数组
     * 
     * @param rawConversation 原始对话数据
     * @returns 原始消息列表
     */
    extractMessages(rawConversation) {
      console.log("[DeepSeekAdapter] extractMessages called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[DeepSeekAdapter] Invalid input to extractMessages");
        return [];
      }
      const data = rawConversation.data;
      let messages = [];
      if (Array.isArray(data.messages)) {
        messages = data.messages;
      } else if (Array.isArray(data.chats)) {
        messages = data.chats;
      } else if (Array.isArray(data.turns)) {
        messages = data.turns;
      } else if (data.mapping) {
        messages = this.extractMessagesFromMapping(data.mapping);
      }
      return messages.map((msg) => ({
        platform: this.platform,
        data: msg
      }));
    }
    /**
     * 获取平台元数据
     * 
     * @returns 平台元数据
     */
    async getMetadata() {
      return {
        platform: this.platform,
        detected: this.detect(),
        endpointsDiscovered: this.apiEndpoints.discovered,
        capturedCount: this.capturedConversations.size,
        metaCount: this.conversationMetas.size,
        capabilityLevel: "L1",
        // 当前实现级别
        capabilityDescription: DEEPSEEK_CAPABILITY_LEVELS.L1
      };
    }
    // ============================================================================
    // 内部方法：平台特征检测
    // ============================================================================
    /**
     * 检测平台特征
     */
    detectPlatformFeatures() {
      var _a;
      if (typeof document === "undefined") {
        return {};
      }
      const features = {
        hostname: window.location.hostname,
        hasFeatureElements: false,
        featureSelectors: [],
        hasGlobalObject: false
      };
      for (const selector of DEEPSEEK_FEATURE_SELECTORS) {
        const element = document.querySelector(selector);
        if (element) {
          features.hasFeatureElements = true;
          (_a = features.featureSelectors) == null ? void 0 : _a.push(selector);
        }
      }
      const possibleGlobals = ["deepseek", "DeepSeekApp", "__DEEPSEEK__"];
      for (const name of possibleGlobals) {
        if (name in window) {
          features.hasGlobalObject = true;
          features.globalObjectName = name;
          break;
        }
      }
      return features;
    }
    // ============================================================================
    // 内部方法：API 端点探测
    // ============================================================================
    /**
     * 动态发现 API 端点
     * 
     * 策略：
     * 1. 从已拦截的请求中选择
     * 2. 从页面 JS 资源中提取
     * 3. 回退到常见端点探测
     * 
     * @returns 发现的 API 端点
     */
    async discoverApiEndpoints() {
      if (this.apiEndpoints.discovered) {
        return this.apiEndpoints;
      }
      const endpoints = {
        detail: null,
        list: null,
        send: null,
        discovered: false
      };
      if (!endpoints.detail) {
        console.log("[DeepSeekAdapter] Using fallback probe for detail API");
        endpoints.detail = await this.probeDetailApi();
      }
      if (!endpoints.list) {
        console.log("[DeepSeekAdapter] Using fallback probe for list API");
        endpoints.list = await this.probeListApi();
      }
      console.log("[DeepSeekAdapter] Discovered API endpoints:", endpoints);
      this.apiEndpoints = { ...endpoints, discovered: true };
      return this.apiEndpoints;
    }
    /**
     * 探测 detail API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     * 可能的策略：
     * 1. 发送 OPTIONS 请求探测端点
     * 2. 从页面 JS 文件中提取 API 路径
     * 3. 监听网络请求并识别模式
     */
    async probeDetailApi() {
      console.warn("[DeepSeekAdapter] probeDetailApi not fully implemented");
      return DEEPSEEK_DETAIL_ENDPOINT_CANDIDATES[0];
    }
    /**
     * 探测 list API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     */
    async probeListApi() {
      console.warn("[DeepSeekAdapter] probeListApi not fully implemented");
      return DEEPSEEK_LIST_ENDPOINT_CANDIDATES[0];
    }
    // ============================================================================
    // 内部方法：数据获取
    // ============================================================================
    /**
     * 获取对话详情
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     * 需要：
     * 1. 确定正确的 API 端点
     * 2. 确定认证方式（Cookie / Token）
     * 3. 确定请求参数格式
     */
    async fetchConversationDetail(_conversationId) {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.detail) {
        console.warn("[DeepSeekAdapter] Detail API endpoint not available (skeleton stage)");
        return null;
      }
      console.warn("[DeepSeekAdapter] fetchConversationDetail not fully implemented");
      return null;
    }
    /**
     * 获取对话列表
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     */
    async fetchConversationList() {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.list) {
        console.warn("[DeepSeekAdapter] List API endpoint not available (skeleton stage)");
        return null;
      }
      console.warn("[DeepSeekAdapter] fetchConversationList not fully implemented");
      return null;
    }
    // ============================================================================
    // 内部方法：数据提取辅助
    // ============================================================================
    /**
     * 从 URL 中提取 conversationId
     * 
     * DeepSeek 的 URL 模式可能是：
     * - https://chat.deepseek.com/chat/{conversation-id}
     * - https://chat.deepseek.com/conversation/{conversation-id}
     * 
     * TODO: 需要实际访问 DeepSeek 网页版验证 URL 结构
     */
    extractConversationIdFromUrl() {
      if (typeof window === "undefined") {
        return "";
      }
      try {
        const url = new URL(window.location.href);
        const pathname = url.pathname;
        for (const pattern of DEEPSEEK_URL_PATTERNS) {
          const match = pathname.match(pattern);
          if (match && match[1]) {
            return match[1];
          }
        }
        return url.searchParams.get("conversationId") || url.searchParams.get("conversation_id") || url.searchParams.get("chatId") || url.searchParams.get("chat_id") || url.searchParams.get("sessionId") || url.searchParams.get("session_id") || url.searchParams.get("id") || "";
      } catch {
        return "";
      }
    }
    /**
     * 从对话项中提取 ID
     * 
     * 支持多种可能的字段名
     */
    extractConversationId(item) {
      return item.conversation_id || item.conversationId || item.chat_id || item.chatId || item.session_id || item.sessionId || item.id || "";
    }
    /**
     * 从对话项中提取标题
     * 
     * 支持多种可能的字段名
     */
    extractConversationTitle(item) {
      return item.title || item.conversationTitle || item.chatTitle || item.name || item.summary || item.topic || item.preview || "DeepSeek Chat";
    }
    /**
     * 从 DOM 中提取对话元数据
     * 
     * TODO: 需要根据 DeepSeek 的实际 DOM 结构实现
     * 需要：
     * 1. 访问 DeepSeek 网页版
     * 2. 检查对话列表的 HTML 结构
     * 3. 确定正确的选择器
     */
    extractConversationMetasFromDom() {
      if (typeof document === "undefined") {
        return [];
      }
      const metas = [];
      const seen = /* @__PURE__ */ new Set();
      const links = document.querySelectorAll('a[href*="/chat/"], a[href*="/conversation/"]');
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        for (const pattern of DEEPSEEK_URL_PATTERNS) {
          const match = href.match(pattern);
          if (!match || !match[1]) continue;
          const id = match[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const text = (a.textContent || "").trim();
          metas.push({
            id,
            title: text || "DeepSeek Chat"
          });
          break;
        }
      }
      return metas;
    }
    /**
     * 从 mapping 结构中提取消息
     * 
     * 如果 DeepSeek 使用树状 mapping 结构来组织消息
     */
    extractMessagesFromMapping(mapping) {
      const messages = [];
      for (const key of Object.keys(mapping)) {
        const node = mapping[key];
        if (node == null ? void 0 : node.message) {
          messages.push(node.message);
        }
      }
      return messages;
    }
    // ============================================================================
    // 内部方法：API 响应拦截（可选）
    // ============================================================================
    /**
     * 安装 API 响应拦截器
     * 
     * TODO: 此方法需要在合适的时机调用（如 userscript 初始化时）
     * 用于拦截 XMLHttpRequest 和 fetch 请求
     * 
     * 需要实现：
     * 1. 拦截 XHR 请求
     * 2. 拦截 fetch 请求
     * 3. 识别 DeepSeek 相关的 API 响应
     * 4. 解析并缓存响应数据
     */
    installInterceptors() {
      if (typeof window === "undefined") {
        return;
      }
      console.log("[DeepSeekAdapter] installInterceptors not fully implemented");
    }
    /**
     * 处理 DeepSeek 详情响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleDeepSeekResponse(text, _url) {
      var _a, _b, _c, _d;
      try {
        const json = JSON.parse(text);
        let convData = null;
        if (Array.isArray(json.messages)) {
          convData = json;
        } else if (Array.isArray(json.chats)) {
          convData = json;
        } else if (Array.isArray(json.turns)) {
          convData = json;
        } else if (json.mapping) {
          convData = json;
        } else if (Array.isArray((_a = json == null ? void 0 : json.data) == null ? void 0 : _a.messages)) {
          convData = json.data;
        } else if (Array.isArray((_b = json == null ? void 0 : json.result) == null ? void 0 : _b.messages)) {
          convData = json.result;
        } else if (Array.isArray((_c = json == null ? void 0 : json.response) == null ? void 0 : _c.messages)) {
          convData = json.response;
        }
        if (!convData) return;
        const idFromUrl = this.extractConversationIdFromUrl();
        const id = idFromUrl || json.id || json.conversation_id || json.chat_id || `${Date.now()}`;
        const title = json.title || ((_d = json.metadata) == null ? void 0 : _d.title) || "DeepSeek Chat";
        this.conversationMetas.set(id, { id, title });
        this.capturedConversations.set(id, convData);
        console.log("[DeepSeekAdapter] Captured conversation:", id);
      } catch (error) {
        console.error("[DeepSeekAdapter] Failed to handle response:", error);
      }
    }
    /**
     * 处理 DeepSeek 列表响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleConversationListResponse(text) {
      var _a;
      try {
        const json = JSON.parse(text);
        const items = json.items || json.conversation_items || json.chats || json.sessions || (Array.isArray(json.data) ? json.data : (_a = json.data) == null ? void 0 : _a.items) || json.result || [];
        const conversations = Array.isArray(items) ? items : [];
        if (conversations.length > 0) {
          for (const item of conversations) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id) {
              this.conversationMetas.set(id, {
                id,
                title,
                createTime: item.created_at,
                updateTime: item.updated_at,
                model: item.model,
                messageCount: item.message_count
              });
            }
          }
        }
      } catch (error) {
        console.error("[DeepSeekAdapter] Failed to handle list response:", error);
      }
    }
  }
  const QWEN_DOMAINS = [
    "tongyi.aliyun.com",
    "tongyi.aliyun.com"
  ];
  const QWEN_DETAIL_ENDPOINT_CANDIDATES = [
    "/api/chat/detail",
    "/api/conversation/detail",
    "/api/session/detail",
    "/api/v1/chat/detail",
    "/api/v1/conversation/detail",
    "/chat/detail",
    "/conversation/detail",
    "/qwen/api/chat/detail",
    "/tongyi/api/chat/detail",
    "/graphql"
    // 通义千问可能使用 GraphQL
  ];
  const QWEN_LIST_ENDPOINT_CANDIDATES = [
    "/api/chat/list",
    "/api/conversation/list",
    "/api/session/list",
    "/api/v1/chat/list",
    "/api/v1/conversation/list",
    "/chat/list",
    "/conversation/list",
    "/qwen/api/chat/list",
    "/tongyi/api/chat/list",
    "/graphql"
    // 通义千问可能使用 GraphQL
  ];
  const QWEN_URL_PATTERNS = [
    /^\/qianwen\/chat\/([a-zA-Z0-9-]+)$/i,
    // /qianwen/chat/{id}
    /^\/chat\/([a-zA-Z0-9-]+)$/i,
    // /chat/{id}
    /^\/conversation\/([a-zA-Z0-9-]+)$/i,
    // /conversation/{id}
    /^\/session\/([a-zA-Z0-9-]+)$/i,
    // /session/{id}
    /^\/c\/([a-zA-Z0-9-]+)$/i
    // /c/{id}
  ];
  const QWEN_CAPABILITY_LEVELS = {
    L1: "从当前页面 DOM 提取可见消息（基础）"
  };
  class QwenAdapter extends BasePlatformAdapter {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "qwen");
      __publicField(this, "apiEndpoints", {
        detail: null,
        list: null,
        discovered: false
      });
      __publicField(this, "capturedConversations", /* @__PURE__ */ new Map());
      __publicField(this, "conversationMetas", /* @__PURE__ */ new Map());
    }
    /**
     * 检测当前页面是否属于通义千问平台
     * 
     * 检测逻辑：
     * 1. 检查域名是否为 tongyi.aliyun.com
     * 2. 检查页面特征（可选，待实现）
     * 
     * @returns 是否为通义千问平台
     */
    detect() {
      if (typeof window === "undefined") {
        return false;
      }
      const hostname = window.location.hostname;
      if (QWEN_DOMAINS.includes(hostname)) {
        return true;
      }
      if (hostname.endsWith(".aliyun.com") && hostname.includes("tongyi")) {
        return true;
      }
      return false;
    }
    /**
     * 获取单个对话的原始数据
     * 
     * 策略：
     * 1. 优先从已捕获的缓存中获取
     * 2. 如果未缓存，尝试通过 API 端点主动获取
     * 3. 支持从 URL 中提取 conversationId
     * 
     * @param conversationId 对话 ID（可选）
     * @returns 原始对话数据，失败时返回 null
     */
    async getConversation(conversationId) {
      console.log("[QwenAdapter] getConversation called", { conversationId });
      if (conversationId && this.capturedConversations.has(conversationId)) {
        const data = this.capturedConversations.get(conversationId);
        return {
          platform: this.platform,
          data
        };
      }
      const idFromUrl = this.extractConversationIdFromUrl();
      const targetId = conversationId || idFromUrl;
      if (!targetId) {
        console.warn("[QwenAdapter] No conversation ID available");
        return null;
      }
      try {
        const detail = await this.fetchConversationDetail(targetId);
        if (detail) {
          this.capturedConversations.set(targetId, detail);
          return {
            platform: this.platform,
            data: detail
          };
        }
      } catch (error) {
        console.error("[QwenAdapter] Failed to fetch conversation:", error);
      }
      console.warn("[QwenAdapter] Falling back to DOM extraction (not implemented)");
      return null;
    }
    /**
     * 获取对话列表的原始数据
     * 
     * 策略：
     * 1. 优先从已拦截的 API 响应中获取
     * 2. 尝试通过 API 端点主动获取
     * 3. 回退到从 DOM 中提取对话元数据
     * 
     * @returns 原始对话列表
     */
    async listConversations() {
      var _a, _b, _c;
      console.log("[QwenAdapter] listConversations called");
      const metas = [];
      for (const [id, detail] of this.capturedConversations.entries()) {
        const title = detail.title || ((_a = detail.metadata) == null ? void 0 : _a.title) || "通义千问对话";
        metas.push({
          id,
          title,
          createTime: detail.create_time,
          updateTime: detail.update_time,
          model: (_b = detail.metadata) == null ? void 0 : _b.model,
          messageCount: (_c = detail.messages) == null ? void 0 : _c.length
        });
      }
      try {
        const listData = await this.fetchConversationList();
        if (listData && Array.isArray(listData)) {
          for (const item of listData) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id && !metas.some((m) => m.id === id)) {
              metas.push({
                id,
                title,
                createTime: item.create_time,
                updateTime: item.update_time,
                model: item.model,
                messageCount: item.message_count
              });
            }
          }
        }
      } catch (error) {
        console.warn("[QwenAdapter] Failed to fetch conversation list:", error);
      }
      if (metas.length === 0) {
        const domMetas = this.extractConversationMetasFromDom();
        for (const meta of domMetas) {
          if (!metas.some((m) => m.id === meta.id)) {
            metas.push(meta);
          }
        }
      }
      return metas.map((meta) => ({
        platform: this.platform,
        data: {
          conversationId: meta.id,
          title: meta.title,
          create_time: meta.createTime,
          update_time: meta.updateTime,
          model: meta.model,
          message_count: meta.messageCount
        }
      }));
    }
    /**
     * 提取消息列表
     * 
     * 将通义千问的 messages/chats/turns/history 数组转换为 RawMessage 数组
     * 
     * @param rawConversation 原始对话数据
     * @returns 原始消息列表
     */
    extractMessages(rawConversation) {
      console.log("[QwenAdapter] extractMessages called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[QwenAdapter] Invalid input to extractMessages");
        return [];
      }
      const data = rawConversation.data;
      let messages = [];
      if (Array.isArray(data.messages)) {
        messages = data.messages;
      } else if (Array.isArray(data.chats)) {
        messages = data.chats;
      } else if (Array.isArray(data.turns)) {
        messages = data.turns;
      } else if (Array.isArray(data.history)) {
        messages = data.history;
      } else if (data.mapping) {
        messages = this.extractMessagesFromMapping(data.mapping);
      }
      return messages.map((msg) => ({
        platform: this.platform,
        data: msg
      }));
    }
    /**
     * 获取平台元数据
     * 
     * @returns 平台元数据
     */
    async getMetadata() {
      return {
        platform: this.platform,
        detected: this.detect(),
        endpointsDiscovered: this.apiEndpoints.discovered,
        capturedCount: this.capturedConversations.size,
        metaCount: this.conversationMetas.size,
        capabilityLevel: "L1",
        // 当前实现级别
        capabilityDescription: QWEN_CAPABILITY_LEVELS.L1
      };
    }
    // ============================================================================
    // 内部方法：API 端点探测
    // ============================================================================
    /**
     * 动态发现 API 端点
     * 
     * 策略：
     * 1. 从已拦截的请求中选择
     * 2. 从页面 JS 资源中提取
     * 3. 回退到常见端点探测
     * 
     * @returns 发现的 API 端点
     */
    async discoverApiEndpoints() {
      if (this.apiEndpoints.discovered) {
        return this.apiEndpoints;
      }
      const endpoints = {
        detail: null,
        list: null,
        discovered: false
      };
      if (!endpoints.detail) {
        console.log("[QwenAdapter] Using fallback probe for detail API");
        endpoints.detail = await this.probeDetailApi();
      }
      if (!endpoints.list) {
        console.log("[QwenAdapter] Using fallback probe for list API");
        endpoints.list = await this.probeListApi();
      }
      console.log("[QwenAdapter] Discovered API endpoints:", endpoints);
      this.apiEndpoints = { ...endpoints, discovered: true };
      return this.apiEndpoints;
    }
    /**
     * 探测 detail API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     * 可能的策略：
     * 1. 发送 OPTIONS 请求探测端点
     * 2. 从页面 JS 文件中提取 API 路径
     * 3. 监听网络请求并识别模式
     */
    async probeDetailApi() {
      console.warn("[QwenAdapter] probeDetailApi not fully implemented");
      return QWEN_DETAIL_ENDPOINT_CANDIDATES[0];
    }
    /**
     * 探测 list API 端点
     * 
     * TODO: 需要实现实际的探测逻辑
     */
    async probeListApi() {
      console.warn("[QwenAdapter] probeListApi not fully implemented");
      return QWEN_LIST_ENDPOINT_CANDIDATES[0];
    }
    // ============================================================================
    // 内部方法：数据获取
    // ============================================================================
    /**
     * 获取对话详情
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     * 需要：
     * 1. 确定正确的 API 端点
     * 2. 确定认证方式（Cookie / Token）
     * 3. 确定请求参数格式
     */
    async fetchConversationDetail(_conversationId) {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.detail) {
        throw new Error("Detail API endpoint not available");
      }
      console.warn("[QwenAdapter] fetchConversationDetail not fully implemented");
      return null;
    }
    /**
     * 获取对话列表
     * 
     * TODO: 需要实现实际的 fetch 逻辑
     */
    async fetchConversationList() {
      const endpoints = await this.discoverApiEndpoints();
      if (!endpoints.list) {
        throw new Error("List API endpoint not available");
      }
      console.warn("[QwenAdapter] fetchConversationList not fully implemented");
      return null;
    }
    // ============================================================================
    // 内部方法：数据提取辅助
    // ============================================================================
    /**
     * 从 URL 中提取 conversationId
     * 
     * 通义千问的 URL 模式可能是：
     * - https://tongyi.aliyun.com/qianwen/chat/{conversation-id}
     * - https://tongyi.aliyun.com/chat/{conversation-id}
     * 
     * TODO: 需要实际访问通义千问网页版验证 URL 结构
     */
    extractConversationIdFromUrl() {
      if (typeof window === "undefined") {
        return "";
      }
      try {
        const url = new URL(window.location.href);
        const pathname = url.pathname;
        for (const pattern of QWEN_URL_PATTERNS) {
          const match = pathname.match(pattern);
          if (match && match[1]) {
            return match[1];
          }
        }
        return url.searchParams.get("conversationId") || url.searchParams.get("conversation_id") || url.searchParams.get("chatId") || url.searchParams.get("chat_id") || url.searchParams.get("sessionId") || url.searchParams.get("session_id") || url.searchParams.get("id") || "";
      } catch {
        return "";
      }
    }
    /**
     * 从对话项中提取 ID
     * 
     * 支持多种可能的字段名
     */
    extractConversationId(item) {
      return item.conversation_id || item.conversationId || item.chat_id || item.chatId || item.session_id || item.sessionId || item.id || "";
    }
    /**
     * 从对话项中提取标题
     * 
     * 支持多种可能的字段名
     */
    extractConversationTitle(item) {
      return item.title || item.conversationTitle || item.chatTitle || item.name || item.summary || item.topic || "通义千问对话";
    }
    /**
     * 从 DOM 中提取对话元数据
     * 
     * TODO: 需要根据通义千问的实际 DOM 结构实现
     * 需要：
     * 1. 访问通义千问网页版
     * 2. 检查对话列表的 HTML 结构
     * 3. 确定正确的选择器
     */
    extractConversationMetasFromDom() {
      if (typeof document === "undefined") {
        return [];
      }
      const metas = [];
      const seen = /* @__PURE__ */ new Set();
      const links = document.querySelectorAll('a[href*="/chat/"], a[href*="/conversation/"]');
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        for (const pattern of QWEN_URL_PATTERNS) {
          const match = href.match(pattern);
          if (!match || !match[1]) continue;
          const id = match[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const text = (a.textContent || "").trim();
          metas.push({
            id,
            title: text || "通义千问对话"
          });
          break;
        }
      }
      return metas;
    }
    /**
     * 从 mapping 结构中提取消息
     * 
     * 如果通义千问使用树状 mapping 结构来组织消息
     */
    extractMessagesFromMapping(mapping) {
      const messages = [];
      for (const key of Object.keys(mapping)) {
        const node = mapping[key];
        if (node == null ? void 0 : node.message) {
          messages.push(node.message);
        }
      }
      return messages;
    }
    // ============================================================================
    // 内部方法：API 响应拦截（可选）
    // ============================================================================
    /**
     * 安装 API 响应拦截器
     * 
     * TODO: 此方法需要在合适的时机调用（如 userscript 初始化时）
     * 用于拦截 XMLHttpRequest 和 fetch 请求
     * 
     * 需要实现：
     * 1. 拦截 XHR 请求
     * 2. 拦截 fetch 请求
     * 3. 识别通义千问相关的 API 响应
     * 4. 解析并缓存响应数据
     */
    installInterceptors() {
      if (typeof window === "undefined") {
        return;
      }
      console.log("[QwenAdapter] installInterceptors not fully implemented");
    }
    /**
     * 处理通义千问详情响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleQwenResponse(text, _url) {
      var _a, _b, _c, _d;
      try {
        const json = JSON.parse(text);
        let convData = null;
        if (Array.isArray(json.messages)) {
          convData = json;
        } else if (Array.isArray(json.chats)) {
          convData = json;
        } else if (Array.isArray(json.turns)) {
          convData = json;
        } else if (Array.isArray(json.history)) {
          convData = json;
        } else if (json.mapping) {
          convData = json;
        } else if (Array.isArray((_a = json == null ? void 0 : json.data) == null ? void 0 : _a.messages)) {
          convData = json.data;
        } else if (Array.isArray((_b = json == null ? void 0 : json.result) == null ? void 0 : _b.messages)) {
          convData = json.result;
        } else if (Array.isArray((_c = json == null ? void 0 : json.response) == null ? void 0 : _c.messages)) {
          convData = json.response;
        }
        if (!convData) return;
        const idFromUrl = this.extractConversationIdFromUrl();
        const id = idFromUrl || json.id || json.conversation_id || json.chat_id || `${Date.now()}`;
        const title = json.title || ((_d = json.metadata) == null ? void 0 : _d.title) || "通义千问对话";
        this.conversationMetas.set(id, { id, title });
        this.capturedConversations.set(id, convData);
        console.log("[QwenAdapter] Captured conversation:", id);
      } catch (error) {
        console.error("[QwenAdapter] Failed to handle response:", error);
      }
    }
    /**
     * 处理通义千问列表响应
     * 
     * TODO: 需要根据实际响应结构调整
     */
    handleConversationListResponse(text) {
      var _a;
      try {
        const json = JSON.parse(text);
        const items = json.items || json.conversation_items || json.chats || json.sessions || json.history || (Array.isArray(json.data) ? json.data : (_a = json.data) == null ? void 0 : _a.items) || json.result || [];
        const conversations = Array.isArray(items) ? items : [];
        if (conversations.length > 0) {
          for (const item of conversations) {
            const id = this.extractConversationId(item);
            const title = this.extractConversationTitle(item);
            if (id) {
              this.conversationMetas.set(id, {
                id,
                title,
                createTime: item.create_time,
                updateTime: item.update_time,
                model: item.model,
                messageCount: item.message_count
              });
            }
          }
        }
      } catch (error) {
        console.error("[QwenAdapter] Failed to handle list response:", error);
      }
    }
  }
  const adapterRegistry = /* @__PURE__ */ new Map();
  adapterRegistry.set("yuanbao", YuanbaoAdapter);
  adapterRegistry.set("chatgpt", ChatGPTAdapter);
  adapterRegistry.set("doubao", DoubaoAdapter);
  adapterRegistry.set("kimi", KimiAdapter);
  adapterRegistry.set("claude", ClaudeAdapter);
  adapterRegistry.set("deepseek", DeepSeekAdapter);
  adapterRegistry.set("qwen", QwenAdapter);
  function getAdapter(platform) {
    const AdapterClass = adapterRegistry.get(platform);
    if (!AdapterClass) {
      console.warn(`[AdapterRegistry] No adapter found for ${platform}`);
      return null;
    }
    return new AdapterClass();
  }
  function detectPlatform() {
    if (typeof window === "undefined") {
      return null;
    }
    for (const [platform, AdapterClass] of adapterRegistry.entries()) {
      try {
        const adapter = new AdapterClass();
        if (adapter.detect && typeof adapter.detect === "function") {
          if (adapter.detect()) {
            console.log(`[AdapterRegistry] Detected platform: ${platform}`);
            return platform;
          }
        }
      } catch (error) {
        console.warn(`[AdapterRegistry] Error detecting platform ${platform}:`, error);
      }
    }
    return null;
  }
  class BaseNormalizer {
    /**
     * 批量标准化
     * 默认实现：逐个调用 normalizeConversation
     */
    async normalizeAll(rawConversations) {
      console.log(`[${this.platform}] Normalizing ${rawConversations.length} conversations`);
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error(`[${this.platform}] Failed to normalize conversation:`, error);
        }
      }
      return results;
    }
    /**
     * 辅助方法：映射角色类型
     * @param rawRole 原始角色字符串
     */
    mapRole(rawRole) {
      const roleMap = {
        user: "user",
        human: "user",
        assistant: "assistant",
        ai: "assistant",
        bot: "assistant",
        system: "system",
        tool: "tool",
        function: "tool"
      };
      return roleMap[rawRole.toLowerCase()] || "unknown";
    }
    /**
     * 辅助方法：解析时间戳
     * @param timestamp 各种格式的时间戳
     */
    parseTimestamp(timestamp) {
      if (timestamp == null) {
        return Date.now();
      }
      if (typeof timestamp === "number") {
        return timestamp < 1e12 ? timestamp * 1e3 : timestamp;
      }
      if (typeof timestamp === "string") {
        const num = Number(timestamp);
        if (!Number.isNaN(num)) {
          return num < 1e12 ? num * 1e3 : num;
        }
        const parsed = new Date(timestamp).getTime();
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
        return Date.now();
      }
      if (timestamp instanceof Date) {
        return timestamp.getTime();
      }
      return Date.now();
    }
    /**
     * 辅助方法：提取文本内容
     * @param content 可能是字符串或复杂对象
     */
    extractText(content) {
      if (typeof content === "string") {
        return content;
      }
      if (typeof content === "object" && content !== null) {
        const obj = content;
        if (typeof obj.text === "string") return obj.text;
        if (typeof obj.content === "string") return obj.content;
        if (typeof obj.body === "string") return obj.body;
        return JSON.stringify(content);
      }
      return String(content);
    }
    /**
     * 生成唯一 ID
     */
    generateId(prefix = "") {
      return `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }
  class YuanbaoNormalizer extends BaseNormalizer {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "yuanbao");
    }
    /**
     * 标准化对话
     * 
     * 将 Yuanbao 原始对话数据转换为统一的 Conversation 格式
     */
    async normalizeConversation(rawConversation) {
      console.log("[YuanbaoNormalizer] normalizeConversation called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[YuanbaoNormalizer] Invalid input, returning empty conversation");
        const now = Date.now();
        return {
          id: this.generateId("yuanbao_"),
          title: "Yuanbao Chat",
          messages: [],
          createdAt: now,
          updatedAt: now,
          metadata: {
            platform: this.platform,
            participantCount: 0,
            messageCount: 0
          }
        };
      }
      const data = rawConversation.data;
      const convs = (data == null ? void 0 : data.convs) || [];
      const conversationId = data.conversationId || data.conversation_id || data.convId || data.conversationUuid || data.sessionId || data.chatId || data.id || this.generateId("yuanbao_");
      const title = data.sessionTitle || data.title || "Yuanbao Chat";
      const messages = [];
      for (const turn of convs) {
        if (!turn) {
          console.warn("[YuanbaoNormalizer] Skipping null/undefined turn");
          continue;
        }
        try {
          const message = await this.normalizeTurn(turn, conversationId);
          if (message) {
            messages.push(message);
          }
        } catch (error) {
          console.error(
            "[YuanbaoNormalizer] Failed to normalize turn:",
            (turn == null ? void 0 : turn.index) ?? "unknown",
            error
          );
        }
      }
      messages.sort((a, b) => a.timestamp - b.timestamp);
      const timestamps = messages.map((m) => m.timestamp).filter((t) => t > 0);
      const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
      const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      return {
        id: conversationId,
        title,
        messages,
        createdAt,
        updatedAt,
        metadata: {
          platform: this.platform,
          participantCount: this.countParticipants(messages),
          messageCount: messages.length,
          originalData: data
        }
      };
    }
    /**
     * 标准化单个消息
     * 
     * 将 Yuanbao 的 turn 转换为统一的 Message 格式
     */
    async normalizeMessage(rawMessage, _conversationId) {
      console.log("[YuanbaoNormalizer] normalizeMessage called");
      const turn = rawMessage.data;
      return this.normalizeTurn(turn, _conversationId);
    }
    /**
     * 批量标准化
     */
    async normalizeAll(rawConversations) {
      console.log(
        `[YuanbaoNormalizer] Normalizing ${rawConversations.length} conversations`
      );
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error("[YuanbaoNormalizer] Failed to normalize conversation:", error);
        }
      }
      return results;
    }
    // ============================================================================
    // 内部方法：标准化逻辑
    // ============================================================================
    /**
     * 标准化一个对话轮次
     */
    async normalizeTurn(turn, conversationId) {
      const role = this.mapYuanbaoRole(turn.speaker);
      const timestamp = this.parseTimestamp(turn.createTime || Date.now());
      const blocks = this.extractMessageBlocks(turn);
      const textParts = [];
      for (const block of blocks) {
        if (block.type === "think") {
          const title = block.title ? `[Think] ${block.title}` : "[Think]";
          textParts.push(`> ${title}
> ${block.text.replace(/\n/g, "\n> ")}`);
        } else {
          textParts.push(block.text);
        }
      }
      const content = {
        text: textParts.join("\n\n").trim() || "_No content_",
        metadata: {
          turnIndex: turn.index,
          blockCount: blocks.length
        }
      };
      return {
        id: this.generateMessageId(conversationId, turn.index),
        role,
        content,
        timestamp,
        metadata: {
          platform: this.platform,
          originalIndex: turn.index,
          originalSpeaker: turn.speaker,
          blockCount: blocks.length
        }
      };
    }
    /**
     * 映射 Yuanbao 角色到统一角色
     */
    mapYuanbaoRole(speaker) {
      if (!speaker) {
        return "unknown";
      }
      const role = speaker.toLowerCase();
      if (role === "ai") {
        return "assistant";
      }
      if (role === "user" || role === "human") {
        return "user";
      }
      if (role === "system") {
        return "system";
      }
      return "unknown";
    }
    /**
     * 从 turn 中提取消息块
     * 
     * 处理 speechesV2 数组中的多种块类型
     */
    extractMessageBlocks(turn) {
      const blocks = [];
      const speeches = turn.speechesV2 || [];
      for (const speech of speeches) {
        const contentBlocks = speech.content || [];
        for (const block of contentBlocks) {
          const extracted = this.extractBlockContent(block);
          if (extracted) {
            blocks.push(extracted);
          }
        }
      }
      return blocks;
    }
    /**
     * 提取单个内容块
     * 
     * 支持多种块类型：
     * - text: 普通文本
     * - think: 思考过程
     * - 其他：标记为 unsupported
     */
    extractBlockContent(block) {
      var _a;
      const type = ((_a = block.type) == null ? void 0 : _a.toLowerCase()) || "unknown";
      if (type === "text") {
        return {
          type: "text",
          text: this.adjustHeaderLevels(block.msg || "", 1)
        };
      }
      if (type === "think") {
        const title = block.title || "";
        const content = Array.isArray(block.content) ? block.content.map((b) => {
          var _a2;
          return (_a2 = this.extractBlockContent(b)) == null ? void 0 : _a2.text;
        }).join("\n") : String(block.content || "");
        return {
          type: "think",
          text: content,
          title,
          metadata: {
            originalType: block.type
          }
        };
      }
      if (block.msg) {
        return {
          type: "unsupported",
          text: `[${type}] ${block.msg}`,
          metadata: {
            originalType: block.type,
            originalBlock: block
          }
        };
      }
      return null;
    }
    /**
     * 调整 Markdown 标题级别
     * 
     * V1 逻辑：将所有标题级别增加 1 级，避免与对话标题冲突
     */
    adjustHeaderLevels(text, increaseBy = 1) {
      if (!text) return "";
      return String(text).replace(/^(#+)(\s*)(.*?)\s*$/gm, (_m, hashes, _space, content) => {
        return "#".repeat(hashes.length + increaseBy) + " " + String(content).trim();
      });
    }
    /**
     * 生成消息 ID
     */
    generateMessageId(conversationId, turnIndex) {
      const index = turnIndex != null ? turnIndex : Date.now();
      return `${conversationId}_msg_${index}`;
    }
    /**
     * 统计参与者数量
     */
    countParticipants(messages) {
      const roles = new Set(messages.map((m) => m.role));
      return roles.size;
    }
  }
  class ChatGPTRNormalizer extends BaseNormalizer {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "chatgpt");
    }
    /**
     * 标准化对话
     * 
     * 将 ChatGPT 原始对话数据转换为统一的 Conversation 格式
     * 
     * @param rawConversation 原始对话数据
     */
    async normalizeConversation(rawConversation) {
      var _a, _b;
      console.log("[ChatGPTRNormalizer] normalizeConversation called");
      const data = rawConversation.data;
      const messages = this.extractMessagesFromData(data);
      const conversationId = data.conversation_id || data.id || this.generateId("chatgpt_");
      const title = data.title || ((_a = data.metadata) == null ? void 0 : _a.title) || "ChatGPT Chat";
      const normalizedMessages = [];
      for (const msg of messages) {
        try {
          const message = await this.normalizeMessage(
            { platform: this.platform, data: msg },
            conversationId
          );
          if (message) {
            normalizedMessages.push(message);
          }
        } catch (error) {
          console.error(
            "[ChatGPTRNormalizer] Failed to normalize message:",
            msg.id,
            error
          );
        }
      }
      normalizedMessages.sort((a, b) => a.timestamp - b.timestamp);
      const timestamps = normalizedMessages.map((m) => m.timestamp).filter((t) => t > 0);
      const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
      const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      return {
        id: conversationId,
        title,
        messages: normalizedMessages,
        createdAt,
        updatedAt,
        metadata: {
          platform: this.platform,
          participantCount: this.countParticipants(normalizedMessages),
          messageCount: normalizedMessages.length,
          originalData: data,
          model: (_b = data.metadata) == null ? void 0 : _b.model
        }
      };
    }
    /**
     * 标准化单个消息
     * 
     * 将 ChatGPT 的 message 转换为统一的 Message 格式
     * 
     * @param rawMessage 原始消息数据
     * @param conversationId 所属对话 ID
     */
    async normalizeMessage(rawMessage, conversationId) {
      console.log("[ChatGPTRNormalizer] normalizeMessage called");
      const msg = rawMessage.data;
      return this.normalizeChatGPTMessage(msg, conversationId);
    }
    /**
     * 批量标准化
     */
    async normalizeAll(rawConversations) {
      console.log(
        `[ChatGPTRNormalizer] Normalizing ${rawConversations.length} conversations`
      );
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error("[ChatGPTRNormalizer] Failed to normalize conversation:", error);
        }
      }
      return results;
    }
    // ============================================================================
    // 内部方法：标准化逻辑
    // ============================================================================
    /**
     * 标准化一个 ChatGPT 消息
     */
    async normalizeChatGPTMessage(msg, conversationId) {
      var _a, _b;
      const role = this.mapChatGPTRole(msg.role);
      const timestamp = this.parseTimestamp(
        msg.timestamp || msg.createTime || Date.now()
      );
      const blocks = this.extractMessageBlocks(msg);
      const textParts = [];
      for (const block of blocks) {
        if (block.type === "code") {
          const lang = ((_a = block.metadata) == null ? void 0 : _a.language) || "";
          textParts.push(`\`\`\`${lang}
${block.text}
\`\`\``);
        } else if (block.type === "image") {
          textParts.push(`![Image](${block.text || "image"})`);
        } else if (block.type === "file") {
          textParts.push(`[File: ${block.title || "attachment"}]`);
        } else {
          textParts.push(block.text);
        }
      }
      const content = {
        text: textParts.join("\n\n").trim() || "_No content_",
        metadata: {
          blockCount: blocks.length,
          originalRole: msg.role
        }
      };
      return {
        id: this.generateMessageId(conversationId, msg.id),
        role,
        content,
        timestamp,
        metadata: {
          platform: this.platform,
          originalId: msg.id,
          originalAuthor: (_b = msg.author) == null ? void 0 : _b.role,
          originalMetadata: msg.metadata
        }
      };
    }
    /**
     * 映射 ChatGPT 角色到统一角色
     */
    mapChatGPTRole(role) {
      if (!role) {
        return "unknown";
      }
      const normalizedRole = role.toLowerCase();
      if (normalizedRole === "assistant" || normalizedRole === "ai") {
        return "assistant";
      }
      if (normalizedRole === "user" || normalizedRole === "human") {
        return "user";
      }
      if (normalizedRole === "system") {
        return "system";
      }
      if (normalizedRole === "tool" || normalizedRole === "function") {
        return "tool";
      }
      return "unknown";
    }
    /**
     * 从消息中提取内容块
     * 
     * 处理 content 可能是字符串或对象数组的情况
     */
    extractMessageBlocks(msg) {
      const blocks = [];
      const content = msg.content;
      if (typeof content === "string") {
        blocks.push({
          type: "text",
          text: content
        });
      } else if (Array.isArray(content)) {
        for (const part of content) {
          const block = this.extractBlockContent(part);
          if (block) {
            blocks.push(block);
          }
        }
      } else if (typeof content === "object" && content !== null) {
        const block = this.extractBlockContent(content);
        if (block) {
          blocks.push(block);
        }
      }
      return blocks;
    }
    /**
     * 提取单个内容块
     * 
     * 支持多种块类型：
     * - text: 普通文本
     * - code: 代码块
     * - image: 图片
     * - file: 文件附件
     * - unsupported: 不支持的类型
     */
    extractBlockContent(part) {
      const type = (part.type || "text").toLowerCase();
      if (type === "text" || !part.type) {
        const text2 = part.text || part.content || String(part);
        return {
          type: "text",
          text: this.adjustHeaderLevels(text2, 1)
        };
      }
      if (type === "code") {
        return {
          type: "code",
          text: part.text || part.content || part.code || "",
          metadata: {
            language: part.language || part.lang || ""
          }
        };
      }
      if (type === "image") {
        return {
          type: "image",
          text: part.url || part.src || part.data || "",
          metadata: {
            alt: part.alt || part.title || ""
          }
        };
      }
      if (type === "file" || type === "attachment") {
        return {
          type: "file",
          text: part.url || part.path || "",
          title: part.name || part.filename || part.title || "Attachment",
          metadata: {
            mimeType: part.mimeType || part.type || "",
            size: part.size
          }
        };
      }
      const text = part.text || part.content || part.msg || String(part);
      if (text) {
        return {
          type: "unsupported",
          text: `[${type}] ${text}`,
          metadata: {
            originalType: part.type,
            originalPart: part
          }
        };
      }
      return null;
    }
    /**
     * 从原始数据中提取消息列表
     * 
     * 支持多种数据结构：
     * - messages 数组
     * - mapping 对象
     */
    extractMessagesFromData(data) {
      var _a, _b;
      if (Array.isArray(data.messages)) {
        return data.messages;
      }
      if (data.mapping) {
        return this.extractMessagesFromMapping(data.mapping);
      }
      if ((_a = data.data) == null ? void 0 : _a.messages) {
        return data.data.messages;
      }
      if ((_b = data.result) == null ? void 0 : _b.messages) {
        return data.result.messages;
      }
      return [];
    }
    /**
     * 从 mapping 结构中提取消息
     */
    extractMessagesFromMapping(mapping) {
      const messages = [];
      for (const key of Object.keys(mapping)) {
        const node = mapping[key];
        if (node == null ? void 0 : node.message) {
          messages.push(node.message);
        }
      }
      return messages;
    }
    /**
     * 调整 Markdown 标题级别
     * 
     * 将所有标题级别增加 1 级，避免与对话标题冲突
     */
    adjustHeaderLevels(text, increaseBy = 1) {
      if (!text) return "";
      return String(text).replace(/^(#+)(\s*)(.*?)\s*$/gm, (_m, hashes, _space, content) => {
        return "#".repeat(hashes.length + increaseBy) + " " + String(content).trim();
      });
    }
    /**
     * 生成消息 ID
     */
    generateMessageId(conversationId, messageId) {
      const id = messageId || Date.now().toString();
      return `${conversationId}_msg_${id}`;
    }
    /**
     * 统计参与者数量
     */
    countParticipants(messages) {
      const roles = new Set(messages.map((m) => m.role));
      return roles.size;
    }
  }
  class DoubaoNormalizer extends BaseNormalizer {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "doubao");
    }
    /**
     * 标准化对话
     * 
     * 将 Doubao 原始对话数据转换为统一的 Conversation 格式
     */
    async normalizeConversation(rawConversation) {
      console.log("[DoubaoNormalizer] normalizeConversation called");
      const data = rawConversation.data;
      const turns = data.data || data.messages || data.turns || data.convs || [];
      const conversationId = data.conversationId || data.conversation_id || data.convId || data.id || data.sessionId || data.chatId || this.generateId("doubao_");
      const title = data.title || data.sessionTitle || data.name || "Doubao Chat";
      const messages = [];
      for (const turn of turns) {
        try {
          const message = await this.normalizeTurn(turn, conversationId);
          if (message) {
            messages.push(message);
          }
        } catch (error) {
          console.error(
            "[DoubaoNormalizer] Failed to normalize turn:",
            turn.index,
            error
          );
        }
      }
      messages.sort((a, b) => a.timestamp - b.timestamp);
      const timestamps = messages.map((m) => m.timestamp).filter((t) => t > 0);
      const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
      const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      return {
        id: conversationId,
        title,
        messages,
        createdAt,
        updatedAt,
        metadata: {
          platform: this.platform,
          participantCount: this.countParticipants(messages),
          messageCount: messages.length,
          originalData: data
        }
      };
    }
    /**
     * 标准化单个消息
     * 
     * 将 Doubao 的 turn 转换为统一的 Message 格式
     */
    async normalizeMessage(rawMessage, _conversationId) {
      console.log("[DoubaoNormalizer] normalizeMessage called");
      const turn = rawMessage.data;
      return this.normalizeTurn(turn, _conversationId);
    }
    /**
     * 批量标准化
     */
    async normalizeAll(rawConversations) {
      console.log(
        `[DoubaoNormalizer] Normalizing ${rawConversations.length} conversations`
      );
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error("[DoubaoNormalizer] Failed to normalize conversation:", error);
        }
      }
      return results;
    }
    // ============================================================================
    // 内部方法：标准化逻辑
    // ============================================================================
    /**
     * 标准化一个对话轮次
     */
    async normalizeTurn(turn, conversationId) {
      const role = this.mapDoubaoRole(turn.role || turn.speaker);
      const timestamp = this.parseTimestamp(turn.createTime || turn.timestamp || Date.now());
      const blocks = this.extractMessageBlocks(turn);
      const contentParts = [];
      for (const block of blocks) {
        contentParts.push(this.formatBlock(block));
      }
      const content = {
        text: contentParts.join("\n\n").trim() || "_No content_",
        metadata: {
          blockCount: blocks.length,
          blockTypes: blocks.map((b) => b.type)
        }
      };
      return {
        id: this.generateMessageId(conversationId, turn.index),
        role,
        content,
        timestamp,
        metadata: {
          platform: this.platform,
          originalIndex: turn.index,
          originalRole: turn.role || turn.speaker,
          turnId: turn.id
        }
      };
    }
    /**
     * 映射 Doubao 角色到统一角色
     */
    mapDoubaoRole(speaker) {
      if (!speaker) {
        return "unknown";
      }
      const role = speaker.toLowerCase();
      if (role === "ai" || role === "assistant" || role === "bot") {
        return "assistant";
      }
      if (role === "user" || role === "human") {
        return "user";
      }
      if (role === "system") {
        return "system";
      }
      if (role === "tool" || role === "function") {
        return "tool";
      }
      return "unknown";
    }
    /**
     * 从 turn 中提取消息块
     * 
     * 处理多种可能的数据结构：
     * - messages 数组
     * - blocks 数组
     * - content 字段
     */
    extractMessageBlocks(turn) {
      const blocks = [];
      const messages = turn.messages || [];
      for (const msg of messages) {
        const contentBlocks = msg.content || [];
        for (const block of contentBlocks) {
          const extracted = this.extractBlockContent(block);
          if (extracted) {
            blocks.push(extracted);
          }
        }
        if (msg.text) {
          blocks.push({
            type: "text",
            text: msg.text
          });
        }
      }
      const turnBlocks = turn.blocks || [];
      for (const block of turnBlocks) {
        const extracted = this.extractBlockContent(block);
        if (extracted) {
          blocks.push(extracted);
        }
      }
      if (blocks.length === 0 && turn.content) {
        blocks.push({
          type: "text",
          text: turn.content
        });
      }
      return blocks;
    }
    /**
     * 提取单个内容块
     * 
     * 支持多种块类型：
     * - text: 普通文本
     * - think: 思考过程
     * - code: 代码块
     * - image: 图片
     * - file: 文件
     * - 其他：标记为 unsupported
     */
    extractBlockContent(block) {
      var _a;
      const type = ((_a = block.type) == null ? void 0 : _a.toLowerCase()) || "unknown";
      if (type === "text") {
        const text = block.content || block.text || "";
        return {
          type: "text",
          text: this.adjustHeaderLevels(text, 1)
        };
      }
      if (type === "think") {
        const title = block.title || "";
        const content = Array.isArray(block.content) ? block.content.map((b) => {
          var _a2;
          return (_a2 = this.extractBlockContent(b)) == null ? void 0 : _a2.text;
        }).join("\n") : String(block.content || block.text || "");
        return {
          type: "think",
          text: content,
          title,
          metadata: {
            originalType: block.type
          }
        };
      }
      if (type === "code") {
        const code = block.content || block.text || "";
        const language = block.language || "plaintext";
        return {
          type: "code",
          text: `\`\`\`${language}
${code}
\`\`\``,
          language,
          metadata: {
            originalType: block.type
          }
        };
      }
      if (type === "image") {
        const url = block.url || block.data;
        const alt = block.title || "[Image]";
        return {
          type: "image",
          text: url ? `![${alt}](${url})` : `![${alt}]()`,
          url,
          metadata: {
            originalType: block.type
          }
        };
      }
      if (type === "file") {
        const url = block.url || block.data;
        const name = block.title || "[File]";
        return {
          type: "file",
          text: url ? `[📎 ${name}](${url})` : `📎 ${name}`,
          url,
          metadata: {
            originalType: block.type
          }
        };
      }
      const textContent = block.content || block.text || block.data || block.title || "";
      if (textContent) {
        return {
          type: "unsupported",
          text: `[${type}] ${textContent}`,
          metadata: {
            originalType: block.type,
            originalBlock: block
          }
        };
      }
      return null;
    }
    /**
     * 格式化消息块为文本
     */
    formatBlock(block) {
      switch (block.type) {
        case "think":
          const title = block.title ? `[Think] ${block.title}` : "[Think]";
          return `> ${title}
> ${block.text.replace(/\n/g, "\n> ")}`;
        case "code":
          return block.text;
        // 代码块已经有 markdown 格式
        case "image":
          return block.text;
        // 图片已经是 markdown 格式
        case "file":
          return block.text;
        // 文件已经是 markdown 格式
        case "text":
        default:
          return block.text;
      }
    }
    /**
     * 调整 Markdown 标题级别
     * 
     * 将所有标题级别增加 1 级，避免与对话标题冲突
     */
    adjustHeaderLevels(text, increaseBy = 1) {
      if (!text) return "";
      return String(text).replace(/^(#+)(\s*)(.*?)\s*$/gm, (_m, hashes, _space, content) => {
        return "#".repeat(hashes.length + increaseBy) + " " + String(content).trim();
      });
    }
    /**
     * 生成消息 ID
     */
    generateMessageId(conversationId, turnIndex) {
      const index = turnIndex != null ? turnIndex : Date.now();
      return `${conversationId}_msg_${index}`;
    }
    /**
     * 统计参与者数量
     */
    countParticipants(messages) {
      const roles = new Set(messages.map((m) => m.role));
      return roles.size;
    }
  }
  class KimiNormalizer extends BaseNormalizer {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "kimi");
    }
    /**
     * 标准化对话
     * 
     * 将 Kimi 原始对话数据转换为统一的 Conversation 格式
     * 
     * @param rawConversation 原始对话数据
     * @returns 标准化后的对话
     */
    async normalizeConversation(rawConversation) {
      var _a, _b;
      console.log("[KimiNormalizer] normalizeConversation called");
      const data = rawConversation.data;
      const messages = this.extractMessagesFromData(data);
      const conversationId = data.conversation_id || data.chat_id || data.session_id || data.id || this.generateId("kimi_");
      const title = data.title || ((_a = data.metadata) == null ? void 0 : _a.title) || "Kimi Chat";
      const normalizedMessages = [];
      for (const msg of messages) {
        try {
          const message = await this.normalizeMessage(
            { platform: this.platform, data: msg },
            conversationId
          );
          if (message) {
            normalizedMessages.push(message);
          }
        } catch (error) {
          console.error(
            "[KimiNormalizer] Failed to normalize message:",
            msg.id,
            error
          );
        }
      }
      normalizedMessages.sort((a, b) => a.timestamp - b.timestamp);
      const timestamps = normalizedMessages.map((m) => m.timestamp).filter((t) => t > 0);
      const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
      const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      return {
        id: conversationId,
        title,
        messages: normalizedMessages,
        createdAt,
        updatedAt,
        metadata: {
          platform: this.platform,
          participantCount: this.countParticipants(normalizedMessages),
          messageCount: normalizedMessages.length,
          originalData: data,
          model: (_b = data.metadata) == null ? void 0 : _b.model,
          // Kimi 特有元数据
          searchEnabled: data.search_enabled,
          files: data.files
        }
      };
    }
    /**
     * 标准化单个消息
     * 
     * 将 Kimi 的 message 转换为统一的 Message 格式
     * 
     * @param rawMessage 原始消息数据
     * @param conversationId 所属对话 ID
     * @returns 标准化后的消息
     */
    async normalizeMessage(rawMessage, conversationId) {
      console.log("[KimiNormalizer] normalizeMessage called");
      const msg = rawMessage.data;
      return this.normalizeKimiMessage(msg, conversationId);
    }
    /**
     * 批量标准化
     * 
     * @param rawConversations 原始对话列表
     * @returns 标准化后的对话列表
     */
    async normalizeAll(rawConversations) {
      console.log(
        `[KimiNormalizer] Normalizing ${rawConversations.length} conversations`
      );
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error("[KimiNormalizer] Failed to normalize conversation:", error);
        }
      }
      return results;
    }
    // ============================================================================
    // 内部方法：标准化逻辑
    // ============================================================================
    /**
     * 标准化一个 Kimi 消息
     * 
     * @param msg Kimi 原始消息
     * @param conversationId 所属对话 ID
     * @returns 标准化后的消息
     */
    async normalizeKimiMessage(msg, conversationId) {
      var _a, _b, _c, _d, _e, _f;
      const role = this.mapKimiRole(msg.role);
      const timestamp = this.parseTimestamp(
        msg.timestamp || msg.create_time || Date.now()
      );
      const blocks = this.extractMessageBlocks(msg);
      const textParts = [];
      const attachments = [];
      for (const block of blocks) {
        if (block.type === "code") {
          const lang = ((_a = block.metadata) == null ? void 0 : _a.language) || "";
          textParts.push(`\`\`\`${lang}
${block.text}
\`\`\``);
        } else if (block.type === "image") {
          const attachment = {
            id: this.generateId("img_"),
            type: "image",
            url: block.text,
            name: typeof ((_b = block.metadata) == null ? void 0 : _b.alt) === "string" ? block.metadata.alt : "image"
          };
          attachments.push(attachment);
          textParts.push(`![Image](${block.text || "image"})`);
        } else if (block.type === "file") {
          const attachment = {
            id: this.generateId("file_"),
            type: "file",
            url: block.text,
            name: block.title || "attachment",
            mimeType: (_c = block.metadata) == null ? void 0 : _c.mimeType,
            size: typeof ((_d = block.metadata) == null ? void 0 : _d.size) === "number" ? block.metadata.size : void 0
          };
          attachments.push(attachment);
          textParts.push(`[File: ${block.title || "attachment"}]`);
        } else if (block.type === "link") {
          textParts.push(`[Link](${block.text})`);
        } else if (block.type === "search") {
          textParts.push(`> 🔍 Search: ${block.text}`);
        } else if (block.type === "unsupported") {
          textParts.push(`[${((_e = block.metadata) == null ? void 0 : _e.originalType) || "unknown"}] ${block.text}`);
        } else {
          textParts.push(block.text);
        }
      }
      const content = {
        text: textParts.join("\n\n").trim() || "_No content_",
        attachments: attachments.length > 0 ? attachments : void 0,
        metadata: {
          blockCount: blocks.length,
          originalRole: msg.role,
          // Kimi 特有元数据
          searchInfo: msg.search_info,
          fileInfo: msg.file_info
        }
      };
      return {
        id: this.generateMessageId(conversationId, msg.id),
        role,
        content,
        timestamp,
        metadata: {
          platform: this.platform,
          originalId: msg.id,
          originalAuthor: (_f = msg.author) == null ? void 0 : _f.role,
          originalMetadata: msg.metadata
        }
      };
    }
    /**
     * 映射 Kimi 角色到统一角色
     * 
     * @param role Kimi 原始角色
     * @returns 统一的角色类型
     */
    mapKimiRole(role) {
      if (!role) {
        return "unknown";
      }
      const normalizedRole = role.toLowerCase();
      if (normalizedRole === "assistant" || normalizedRole === "ai" || normalizedRole === "bot") {
        return "assistant";
      }
      if (normalizedRole === "user" || normalizedRole === "human") {
        return "user";
      }
      if (normalizedRole === "system") {
        return "system";
      }
      if (normalizedRole === "tool" || normalizedRole === "function") {
        return "tool";
      }
      return "unknown";
    }
    /**
     * 从消息中提取内容块
     * 
     * 处理 content 可能是字符串或对象数组的情况
     * 
     * @param msg Kimi 消息
     * @returns 内容块列表
     */
    extractMessageBlocks(msg) {
      const blocks = [];
      const content = msg.content;
      if (typeof content === "string") {
        blocks.push({
          type: "text",
          text: content
        });
      } else if (Array.isArray(content)) {
        for (const part of content) {
          const block = this.extractBlockContent(part);
          if (block) {
            blocks.push(block);
          }
        }
      } else if (typeof content === "object" && content !== null) {
        const block = this.extractBlockContent(content);
        if (block) {
          blocks.push(block);
        }
      }
      return blocks;
    }
    /**
     * 提取单个内容块
     * 
     * 支持多种块类型：
     * - text: 普通文本
     * - code: 代码块
     * - image: 图片
     * - file: 文件附件
     * - link: 链接
     * - search: 搜索结果引用
     * - unsupported: 不支持的类型
     * 
     * @param part 内容部分
     * @returns 提取的内容块
     */
    extractBlockContent(part) {
      const type = (part.type || "text").toLowerCase();
      if (type === "text" || !part.type) {
        return {
          type: "text",
          text: this.adjustHeaderLevels(part.text || part.content || String(part), 1)
        };
      }
      if (type === "code") {
        return {
          type: "code",
          text: part.text || part.content || part.code || "",
          metadata: {
            language: part.language || part.lang || ""
          }
        };
      }
      if (type === "image") {
        return {
          type: "image",
          text: part.url || part.src || part.data || "",
          metadata: {
            alt: part.alt || part.title || ""
          }
        };
      }
      if (type === "file" || type === "attachment") {
        return {
          type: "file",
          text: part.url || part.path || "",
          title: part.name || part.filename || part.title || "Attachment",
          metadata: {
            mimeType: part.mimeType || part.type || "",
            size: part.size
          }
        };
      }
      if (type === "link" || type === "url") {
        return {
          type: "link",
          text: part.url || part.href || part.link || "",
          title: part.title || part.name || "",
          metadata: {
            description: part.description || part.snippet || ""
          }
        };
      }
      if (type === "search" || type === "search_result") {
        return {
          type: "search",
          text: part.title || part.url || part.snippet || "Search Result",
          metadata: {
            source: part.source || part.domain || "",
            url: part.url || part.link || ""
          }
        };
      }
      const text = part.text || part.content || part.msg || String(part);
      if (text) {
        return {
          type: "unsupported",
          text: `[${type}] ${text}`,
          metadata: {
            originalType: part.type,
            originalPart: part
          }
        };
      }
      return null;
    }
    /**
     * 从原始数据中提取消息列表
     * 
     * 支持多种数据结构：
     * - messages 数组
     * - chats 数组（Kimi 可能使用）
     * - turns 数组
     * - mapping 对象
     * 
     * @param data Kimi 原始对话数据
     * @returns 消息列表
     */
    extractMessagesFromData(data) {
      var _a, _b, _c;
      if (Array.isArray(data.messages)) {
        return data.messages;
      }
      if (Array.isArray(data.chats)) {
        return data.chats;
      }
      if (Array.isArray(data.turns)) {
        return data.turns;
      }
      if (data.mapping) {
        return this.extractMessagesFromMapping(data.mapping);
      }
      if ((_a = data.data) == null ? void 0 : _a.messages) {
        return data.data.messages;
      }
      if ((_b = data.result) == null ? void 0 : _b.messages) {
        return data.result.messages;
      }
      if ((_c = data.response) == null ? void 0 : _c.messages) {
        return data.response.messages;
      }
      return [];
    }
    /**
     * 从 mapping 结构中提取消息
     * 
     * @param mapping Kimi mapping 对象
     * @returns 消息列表
     */
    extractMessagesFromMapping(mapping) {
      const messages = [];
      for (const key of Object.keys(mapping)) {
        const node = mapping[key];
        if (node == null ? void 0 : node.message) {
          messages.push(node.message);
        }
      }
      return messages;
    }
    /**
     * 调整 Markdown 标题级别
     * 
     * 将所有标题级别增加 1 级，避免与对话标题冲突
     * 
     * @param text 原始文本
     * @param increaseBy 增加的级别数
     * @returns 调整后的文本
     */
    adjustHeaderLevels(text, increaseBy = 1) {
      if (!text) return "";
      return String(text).replace(/^(#+)(\s*)(.*?)\s*$/gm, (_m, hashes, _space, content) => {
        return "#".repeat(hashes.length + increaseBy) + " " + String(content).trim();
      });
    }
    /**
     * 生成消息 ID
     * 
     * @param conversationId 对话 ID
     * @param messageId 原始消息 ID
     * @returns 生成的唯一 ID
     */
    generateMessageId(conversationId, messageId) {
      const id = messageId || Date.now().toString();
      return `${conversationId}_msg_${id}`;
    }
    /**
     * 统计参与者数量
     * 
     * @param messages 消息列表
     * @returns 参与者数量
     */
    countParticipants(messages) {
      const roles = new Set(messages.map((m) => m.role));
      return roles.size;
    }
  }
  class ClaudeNormalizer extends BaseNormalizer {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "claude");
    }
    /**
     * 标准化对话
     * 
     * 将 Claude 原始对话数据转换为统一的 Conversation 格式
     * 
     * @param rawConversation 原始对话数据
     */
    async normalizeConversation(rawConversation) {
      var _a, _b, _c, _d;
      console.log("[ClaudeNormalizer] normalizeConversation called");
      const data = rawConversation.data;
      const messages = this.extractMessagesFromData(data);
      const conversationId = data.uuid || data.id || data.conversation_id || data.chat_id || this.generateId("claude_");
      const title = data.title || ((_a = data.metadata) == null ? void 0 : _a.title) || "Claude Chat";
      const normalizedMessages = [];
      for (const msg of messages) {
        try {
          const message = await this.normalizeMessage(
            { platform: this.platform, data: msg },
            conversationId
          );
          if (message) {
            normalizedMessages.push(message);
          }
        } catch (error) {
          console.error(
            "[ClaudeNormalizer] Failed to normalize message:",
            msg.id,
            error
          );
        }
      }
      normalizedMessages.sort((a, b) => a.timestamp - b.timestamp);
      const timestamps = normalizedMessages.map((m) => m.timestamp).filter((t) => t > 0);
      const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
      const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      return {
        id: conversationId,
        title,
        messages: normalizedMessages,
        createdAt,
        updatedAt,
        metadata: {
          platform: this.platform,
          participantCount: this.countParticipants(normalizedMessages),
          messageCount: normalizedMessages.length,
          originalData: data,
          model: (_b = data.metadata) == null ? void 0 : _b.model,
          projectUuid: data.project_uuid || ((_c = data.metadata) == null ? void 0 : _c.project_uuid),
          organizationUuid: data.organization_uuid || ((_d = data.metadata) == null ? void 0 : _d.organization_uuid)
        }
      };
    }
    /**
     * 标准化单个消息
     * 
     * 将 Claude 的 message 转换为统一的 Message 格式
     * 
     * @param rawMessage 原始消息数据
     * @param conversationId 所属对话 ID
     */
    async normalizeMessage(rawMessage, conversationId) {
      console.log("[ClaudeNormalizer] normalizeMessage called");
      const msg = rawMessage.data;
      return this.normalizeClaudeMessage(msg, conversationId);
    }
    /**
     * 批量标准化
     */
    async normalizeAll(rawConversations) {
      console.log(
        `[ClaudeNormalizer] Normalizing ${rawConversations.length} conversations`
      );
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error("[ClaudeNormalizer] Failed to normalize conversation:", error);
        }
      }
      return results;
    }
    // ============================================================================
    // 内部方法：标准化逻辑
    // ============================================================================
    /**
     * 标准化一个 Claude 消息
     */
    async normalizeClaudeMessage(msg, conversationId) {
      var _a, _b, _c, _d, _e;
      const role = this.mapClaudeRole(msg.role);
      const timestamp = this.parseTimestamp(
        msg.timestamp || msg.created_at || msg.updated_at || Date.now()
      );
      const blocks = this.extractMessageBlocks(msg);
      const textParts = [];
      const attachments = [];
      for (const block of blocks) {
        if (block.type === "code") {
          const lang = ((_a = block.metadata) == null ? void 0 : _a.language) || "";
          textParts.push(`\`\`\`${lang}
${block.text}
\`\`\``);
        } else if (block.type === "image") {
          const attachment = {
            id: this.generateId("img_"),
            type: "image",
            url: block.text || void 0,
            name: block.title || "Image",
            mimeType: (_b = block.metadata) == null ? void 0 : _b.mimeType
          };
          attachments.push(attachment);
          textParts.push(`![${block.title || "Image"}](${block.text || "image"})`);
        } else if (block.type === "file") {
          const attachment = {
            id: this.generateId("file_"),
            type: "file",
            url: block.text || void 0,
            name: block.title || "Attachment",
            mimeType: (_c = block.metadata) == null ? void 0 : _c.mimeType,
            size: (_d = block.metadata) == null ? void 0 : _d.size
          };
          attachments.push(attachment);
          textParts.push(`[📎 ${block.title || "Attachment"}]`);
        } else if (block.type === "tool_use") {
          textParts.push(`[🔧 Tool Use: ${block.title || "unknown"}]`);
          if (block.text) {
            textParts.push(`\`\`\`json
${block.text}
\`\`\``);
          }
        } else if (block.type === "tool_result") {
          textParts.push(`[🔧 Tool Result: ${block.title || "unknown"}]`);
          if (block.text) {
            textParts.push(`\`\`\`
${block.text}
\`\`\``);
          }
        } else {
          textParts.push(block.text);
        }
      }
      const content = {
        text: textParts.join("\n\n").trim() || "_No content_",
        attachments: attachments.length > 0 ? attachments : void 0,
        metadata: {
          blockCount: blocks.length,
          originalRole: msg.role
        }
      };
      return {
        id: this.generateMessageId(conversationId, msg.id || msg.uuid),
        role,
        content,
        timestamp,
        metadata: {
          platform: this.platform,
          originalId: msg.id || msg.uuid,
          originalSender: (_e = msg.sender) == null ? void 0 : _e.role,
          originalMetadata: msg.metadata
        }
      };
    }
    /**
     * 映射 Claude 角色到统一角色
     */
    mapClaudeRole(role) {
      if (!role) {
        return "unknown";
      }
      const normalizedRole = role.toLowerCase();
      if (normalizedRole === "assistant" || normalizedRole === "ai" || normalizedRole === "claude") {
        return "assistant";
      }
      if (normalizedRole === "user" || normalizedRole === "human") {
        return "user";
      }
      if (normalizedRole === "system") {
        return "system";
      }
      if (normalizedRole === "tool" || normalizedRole === "function") {
        return "tool";
      }
      return "unknown";
    }
    /**
     * 从消息中提取内容块
     * 
     * 处理 content 可能是字符串或对象数组的情况
     */
    extractMessageBlocks(msg) {
      const blocks = [];
      const content = msg.content;
      if (typeof content === "string") {
        blocks.push({
          type: "text",
          text: content
        });
      } else if (Array.isArray(content)) {
        for (const part of content) {
          const block = this.extractBlockContent(part);
          if (block) {
            blocks.push(block);
          }
        }
      } else if (typeof content === "object" && content !== null) {
        const block = this.extractBlockContent(content);
        if (block) {
          blocks.push(block);
        }
      }
      return blocks;
    }
    /**
     * 提取单个内容块
     * 
     * 支持多种块类型：
     * - text: 普通文本
     * - code: 代码块
     * - image: 图片
     * - file: 文件附件
     * - tool_use: 工具调用
     * - tool_result: 工具结果
     * - unsupported: 不支持的类型
     */
    extractBlockContent(part) {
      const type = (part.type || "text").toLowerCase();
      if (type === "text" || !part.type) {
        const text2 = part.text || part.content || String(part);
        return {
          type: "text",
          text: this.adjustHeaderLevels(text2, 1)
        };
      }
      if (type === "code") {
        return {
          type: "code",
          text: part.text || part.content || part.code || "",
          metadata: {
            language: part.language || part.lang || ""
          }
        };
      }
      if (type === "image") {
        const source = part.source;
        let url = "";
        let mimeType = "";
        if (typeof source === "object" && source !== null) {
          url = source.data || source.url || "";
          mimeType = source.media_type || "";
        } else {
          url = part.url || part.src || part.data || "";
        }
        return {
          type: "image",
          text: url,
          title: part.alt || part.title || part.name || "Image",
          metadata: {
            mimeType,
            sourceType: source == null ? void 0 : source.type
          }
        };
      }
      if (type === "file" || type === "attachment") {
        return {
          type: "file",
          text: part.url || part.path || "",
          title: part.name || part.filename || part.title || "Attachment",
          metadata: {
            mimeType: part.mimeType || part.type || "",
            size: part.size
          }
        };
      }
      if (type === "tool_use") {
        return {
          type: "tool_use",
          text: JSON.stringify(part.input || part.parameters || {}, null, 2),
          title: part.name || part.tool_name || "Tool",
          metadata: {
            toolId: part.id,
            toolName: part.name
          }
        };
      }
      if (type === "tool_result") {
        const content = part.content || part.result || part.output || "";
        return {
          type: "tool_result",
          text: typeof content === "string" ? content : JSON.stringify(content, null, 2),
          title: part.tool_name || part.tool_use_id || "Tool Result",
          metadata: {
            toolUseId: part.tool_use_id,
            isError: part.is_error
          }
        };
      }
      const text = part.text || part.content || part.msg || String(part);
      if (text) {
        return {
          type: "unsupported",
          text: `[${type}] ${text}`,
          metadata: {
            originalType: part.type,
            originalPart: part
          }
        };
      }
      return null;
    }
    /**
     * 从原始数据中提取消息列表
     * 
     * 支持多种数据结构：
     * - messages 数组
     * - turns 数组
     * - chat_history 数组
     */
    extractMessagesFromData(data) {
      var _a, _b, _c, _d;
      if (Array.isArray(data.messages)) {
        return data.messages;
      }
      if (Array.isArray(data.turns)) {
        return data.turns;
      }
      if (Array.isArray(data.chat_history)) {
        return data.chat_history;
      }
      if ((_a = data.chat) == null ? void 0 : _a.messages) {
        return data.chat.messages;
      }
      if ((_b = data.conversation) == null ? void 0 : _b.messages) {
        return data.conversation.messages;
      }
      if ((_c = data.data) == null ? void 0 : _c.messages) {
        return data.data.messages;
      }
      if ((_d = data.result) == null ? void 0 : _d.messages) {
        return data.result.messages;
      }
      return [];
    }
    /**
     * 调整 Markdown 标题级别
     * 
     * 将所有标题级别增加 1 级，避免与对话标题冲突
     */
    adjustHeaderLevels(text, increaseBy = 1) {
      if (!text) return "";
      return String(text).replace(/^(#+)(\s*)(.*?)\s*$/gm, (_m, hashes, _space, content) => {
        return "#".repeat(hashes.length + increaseBy) + " " + String(content).trim();
      });
    }
    /**
     * 生成消息 ID
     */
    generateMessageId(conversationId, messageId) {
      const id = messageId || Date.now().toString();
      return `${conversationId}_msg_${id}`;
    }
    /**
     * 统计参与者数量
     */
    countParticipants(messages) {
      const roles = new Set(messages.map((m) => m.role));
      return roles.size;
    }
  }
  class DeepSeekNormalizer extends BaseNormalizer {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "deepseek");
    }
    /**
     * 标准化对话
     * 
     * 将 DeepSeek 原始对话数据转换为统一的 Conversation 格式
     */
    async normalizeConversation(rawConversation) {
      var _a, _b;
      console.log("[DeepSeekNormalizer] normalizeConversation called");
      if (!rawConversation || !rawConversation.data) {
        console.warn("[DeepSeekNormalizer] Invalid input, returning empty conversation");
        return {
          id: this.generateId("deepseek_"),
          title: "DeepSeek Chat",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: {
            platform: this.platform,
            participantCount: 0,
            messageCount: 0
          }
        };
      }
      const data = rawConversation.data;
      const messages = data.messages || data.chats || data.turns || [];
      const conversationId = data.conversation_id || data.conversationId || data.chat_id || data.chatId || data.session_id || data.sessionId || data.id || this.generateId("deepseek_");
      const title = data.title || ((_a = data.metadata) == null ? void 0 : _a.title) || "DeepSeek Chat";
      const normalizedMessages = [];
      for (const msg of messages) {
        try {
          const message = await this.normalizeMessageItem(msg, conversationId);
          if (message) {
            normalizedMessages.push(message);
          }
        } catch (error) {
          console.error(
            "[DeepSeekNormalizer] Failed to normalize message:",
            String(msg.id ?? "unknown"),
            error
          );
        }
      }
      normalizedMessages.sort((a, b) => a.timestamp - b.timestamp);
      const timestamps = normalizedMessages.map((m) => m.timestamp).filter((t) => t > 0);
      const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
      const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      return {
        id: conversationId,
        title,
        messages: normalizedMessages,
        createdAt,
        updatedAt,
        metadata: {
          platform: this.platform,
          participantCount: this.countParticipants(normalizedMessages),
          messageCount: normalizedMessages.length,
          originalData: data,
          model: data.model || ((_b = data.metadata) == null ? void 0 : _b.model) || ""
        }
      };
    }
    /**
     * 标准化单个消息
     * 
     * 将 DeepSeek 的 message 转换为统一的 Message 格式
     */
    async normalizeMessage(rawMessage, _conversationId) {
      console.log("[DeepSeekNormalizer] normalizeMessage called");
      const msg = rawMessage.data;
      return this.normalizeMessageItem(msg, _conversationId);
    }
    /**
     * 批量标准化
     */
    async normalizeAll(rawConversations) {
      console.log(
        `[DeepSeekNormalizer] Normalizing ${rawConversations.length} conversations`
      );
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error("[DeepSeekNormalizer] Failed to normalize conversation:", error);
        }
      }
      return results;
    }
    // ============================================================================
    // 内部方法：标准化逻辑
    // ============================================================================
    /**
     * 标准化单个消息项
     */
    async normalizeMessageItem(msg, conversationId) {
      var _a;
      const role = this.mapDeepSeekRole(msg.role);
      const timestamp = this.parseTimestamp(msg.created_at || msg.timestamp || Date.now());
      const contentResult = this.extractAndFormatContent(msg);
      const content = {
        text: contentResult.text || "_No content_",
        attachments: contentResult.attachments,
        metadata: {
          blockTypes: contentResult.blockTypes,
          hasReasoning: !!msg.reasoning_content
        }
      };
      return {
        id: this.generateMessageId(conversationId, msg.id),
        role,
        content,
        timestamp,
        metadata: {
          platform: this.platform,
          originalId: msg.id,
          originalRole: msg.role,
          model: (_a = msg.metadata) == null ? void 0 : _a.model,
          hasReasoning: !!msg.reasoning_content
        }
      };
    }
    /**
     * 映射 DeepSeek 角色到统一角色
     */
    mapDeepSeekRole(role) {
      if (!role) {
        return "unknown";
      }
      const r = role.toLowerCase();
      if (r === "assistant" || r === "ai" || r === "bot" || r === "model") {
        return "assistant";
      }
      if (r === "user" || r === "human") {
        return "user";
      }
      if (r === "system") {
        return "system";
      }
      if (r === "tool" || r === "function") {
        return "tool";
      }
      return "unknown";
    }
    /**
     * 提取并格式化消息内容
     * 
     * 处理多种可能的内容格式：
     * - 纯文本
     * - 内容块数组
     * - 复杂对象
     */
    extractAndFormatContent(msg) {
      const contentParts = [];
      const attachments = [];
      const blockTypes = [];
      if (msg.reasoning_content) {
        contentParts.push(`> [Reasoning]
> ${String(msg.reasoning_content).replace(/\n/g, "\n> ")}`);
        blockTypes.push("reasoning");
      }
      const content = msg.content;
      if (typeof content === "string") {
        contentParts.push(this.adjustHeaderLevels(content, 1));
        blockTypes.push("text");
      } else if (Array.isArray(content)) {
        for (const part of content) {
          const result = this.processContentPart(part);
          if (result.text) {
            contentParts.push(result.text);
          }
          if (result.type) {
            blockTypes.push(result.type);
          }
          if (result.attachment) {
            attachments.push(result.attachment);
          }
        }
      } else if (typeof content === "object" && content !== null) {
        const obj = content;
        const text = obj.text || obj.content || obj.body || "";
        if (text) {
          contentParts.push(this.adjustHeaderLevels(String(text), 1));
          blockTypes.push("text");
        }
      }
      if (msg.attachments && Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          const attachment = this.normalizeAttachment(att);
          if (attachment) {
            attachments.push(attachment);
          }
        }
      }
      return {
        text: contentParts.join("\n\n").trim(),
        attachments: attachments.length > 0 ? attachments : void 0,
        blockTypes
      };
    }
    /**
     * 处理单个内容块
     */
    processContentPart(part) {
      var _a;
      const type = ((_a = part.type) == null ? void 0 : _a.toLowerCase()) || "text";
      if (type === "text" || !part.type) {
        const text = part.text || part.content || "";
        return {
          text: this.adjustHeaderLevels(text, 1),
          type: "text"
        };
      }
      if (type === "code") {
        const code = part.text || part.content || "";
        const language = part.language || "plaintext";
        return {
          text: `\`\`\`${language}
${code}
\`\`\``,
          type: "code"
        };
      }
      if (type === "image") {
        const url = part.url || part.data;
        const alt = part.alt || part.title || "Image";
        if (url) {
          return {
            text: `![${alt}](${url})`,
            type: "image",
            attachment: {
              id: this.generateId("img_"),
              type: "image",
              url: String(url),
              name: alt
            }
          };
        }
      }
      if (type === "file") {
        const url = part.url || part.data;
        const name = part.name || part.title || "File";
        if (url) {
          return {
            text: `[📎 ${name}](${url})`,
            type: "file",
            attachment: {
              id: this.generateId("file_"),
              type: "file",
              url: String(url),
              name,
              mimeType: part.mime_type || part.type
            }
          };
        }
      }
      if (type === "link") {
        const url = part.url || part.href;
        const title = part.title || part.text || url;
        if (url) {
          return {
            text: `[${title}](${url})`,
            type: "link"
          };
        }
      }
      if (type === "citation" || type === "source") {
        const title = part.title || part.name || "Source";
        const url = part.url || part.href;
        const snippet = part.snippet || part.description || "";
        const text = url ? `[${title}](${url})` : title;
        return {
          text: snippet ? `${text}
> ${snippet}` : text,
          type: "citation"
        };
      }
      const textContent = part.text || part.content || part.data || "";
      if (textContent) {
        return {
          text: `[${type}] ${textContent}`,
          type: "unsupported"
        };
      }
      return {};
    }
    /**
     * 标准化附件
     */
    normalizeAttachment(att) {
      const id = att.id || att.file_id;
      const url = att.url || att.download_url;
      const name = att.name || att.filename || "Attachment";
      const mimeType = att.type || att.mime_type || att.mimeType;
      const size = att.size;
      if (!url) {
        return null;
      }
      let type = "file";
      if (typeof mimeType === "string") {
        if (mimeType.startsWith("image/")) type = "image";
        else if (mimeType.startsWith("video/")) type = "video";
        else if (mimeType.startsWith("audio/")) type = "audio";
      }
      return {
        id: id || this.generateId("att_"),
        type,
        url: String(url),
        name,
        mimeType,
        size,
        metadata: att
      };
    }
    /**
     * 调整 Markdown 标题级别
     * 
     * 将所有标题级别增加 1 级，避免与对话标题冲突
     */
    adjustHeaderLevels(text, increaseBy = 1) {
      if (!text) return "";
      return String(text).replace(/^(#+)(\s*)(.*?)\s*$/gm, (_m, hashes, _space, content) => {
        return "#".repeat(hashes.length + increaseBy) + " " + String(content).trim();
      });
    }
    /**
     * 生成消息 ID
     */
    generateMessageId(conversationId, messageId) {
      if (messageId) {
        return `${conversationId}_msg_${messageId}`;
      }
      return `${conversationId}_msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }
    /**
     * 统计参与者数量
     */
    countParticipants(messages) {
      const roles = new Set(messages.map((m) => m.role));
      return roles.size;
    }
  }
  class QwenNormalizer extends BaseNormalizer {
    constructor() {
      super(...arguments);
      __publicField(this, "platform", "qwen");
    }
    /**
     * 标准化对话
     * 
     * 将通义千问原始对话数据转换为统一的 Conversation 格式
     * 
     * @param rawConversation 原始对话数据
     * @returns 标准化后的对话
     */
    async normalizeConversation(rawConversation) {
      var _a, _b;
      console.log("[QwenNormalizer] normalizeConversation called");
      const data = rawConversation.data;
      const messages = this.extractMessagesFromData(data);
      const conversationId = data.conversation_id || data.chat_id || data.session_id || data.id || this.generateId("qwen_");
      const title = data.title || ((_a = data.metadata) == null ? void 0 : _a.title) || "通义千问对话";
      const normalizedMessages = [];
      for (const msg of messages) {
        try {
          const message = await this.normalizeMessage(
            { platform: this.platform, data: msg },
            conversationId
          );
          if (message) {
            normalizedMessages.push(message);
          }
        } catch (error) {
          console.error(
            "[QwenNormalizer] Failed to normalize message:",
            msg.id,
            error
          );
        }
      }
      normalizedMessages.sort((a, b) => a.timestamp - b.timestamp);
      const timestamps = normalizedMessages.map((m) => m.timestamp).filter((t) => t > 0);
      const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
      const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      return {
        id: conversationId,
        title,
        messages: normalizedMessages,
        createdAt,
        updatedAt,
        metadata: {
          platform: this.platform,
          participantCount: this.countParticipants(normalizedMessages),
          messageCount: normalizedMessages.length,
          originalData: data,
          model: (_b = data.metadata) == null ? void 0 : _b.model,
          // 通义千问特有元数据
          pluginEnabled: data.plugin_enabled,
          files: data.files,
          images: data.images
        }
      };
    }
    /**
     * 标准化单个消息
     * 
     * 将通义千问的 message 转换为统一的 Message 格式
     * 
     * @param rawMessage 原始消息数据
     * @param conversationId 所属对话 ID
     * @returns 标准化后的消息
     */
    async normalizeMessage(rawMessage, conversationId) {
      console.log("[QwenNormalizer] normalizeMessage called");
      const msg = rawMessage.data;
      return this.normalizeQwenMessage(msg, conversationId);
    }
    /**
     * 批量标准化
     * 
     * @param rawConversations 原始对话列表
     * @returns 标准化后的对话列表
     */
    async normalizeAll(rawConversations) {
      console.log(
        `[QwenNormalizer] Normalizing ${rawConversations.length} conversations`
      );
      const results = [];
      for (const raw of rawConversations) {
        try {
          const normalized = await this.normalizeConversation(raw);
          results.push(normalized);
        } catch (error) {
          console.error("[QwenNormalizer] Failed to normalize conversation:", error);
        }
      }
      return results;
    }
    // ============================================================================
    // 内部方法：标准化逻辑
    // ============================================================================
    /**
     * 标准化一个通义千问消息
     * 
     * @param msg 通义千问原始消息
     * @param conversationId 所属对话 ID
     * @returns 标准化后的消息
     */
    async normalizeQwenMessage(msg, conversationId) {
      var _a, _b, _c, _d, _e, _f;
      const role = this.mapQwenRole(msg.role);
      const timestamp = this.parseTimestamp(
        msg.timestamp || msg.create_time || Date.now()
      );
      const blocks = this.extractMessageBlocks(msg);
      const textParts = [];
      const attachments = [];
      for (const block of blocks) {
        if (block.type === "code") {
          const lang = ((_a = block.metadata) == null ? void 0 : _a.language) || "";
          textParts.push(`\`\`\`${lang}
${block.text}
\`\`\``);
        } else if (block.type === "image") {
          const attachment = {
            id: this.generateId("img_"),
            type: "image",
            url: block.text,
            name: typeof ((_b = block.metadata) == null ? void 0 : _b.alt) === "string" ? block.metadata.alt : "image"
          };
          attachments.push(attachment);
          textParts.push(`![Image](${block.text || "image"})`);
        } else if (block.type === "file") {
          const attachment = {
            id: this.generateId("file_"),
            type: "file",
            url: block.text,
            name: block.title || "attachment",
            mimeType: (_c = block.metadata) == null ? void 0 : _c.mimeType,
            size: typeof ((_d = block.metadata) == null ? void 0 : _d.size) === "number" ? block.metadata.size : void 0
          };
          attachments.push(attachment);
          textParts.push(`[File: ${block.title || "attachment"}]`);
        } else if (block.type === "link") {
          textParts.push(`[Link](${block.text})`);
        } else if (block.type === "plugin") {
          textParts.push(`> 🔌 Plugin: ${block.text}`);
        } else if (block.type === "unsupported") {
          textParts.push(`[${((_e = block.metadata) == null ? void 0 : _e.originalType) || "unknown"}] ${block.text}`);
        } else {
          textParts.push(block.text);
        }
      }
      const content = {
        text: textParts.join("\n\n").trim() || "_No content_",
        attachments: attachments.length > 0 ? attachments : void 0,
        metadata: {
          blockCount: blocks.length,
          originalRole: msg.role,
          // 通义千问特有元数据
          pluginInfo: msg.plugin_info,
          fileInfo: msg.file_info,
          imageInfo: msg.image_info
        }
      };
      return {
        id: this.generateMessageId(conversationId, msg.id),
        role,
        content,
        timestamp,
        metadata: {
          platform: this.platform,
          originalId: msg.id,
          originalAuthor: (_f = msg.author) == null ? void 0 : _f.role,
          originalMetadata: msg.metadata
        }
      };
    }
    /**
     * 映射通义千问角色到统一角色
     * 
     * @param role 通义千问原始角色
     * @returns 统一的角色类型
     */
    mapQwenRole(role) {
      if (!role) {
        return "unknown";
      }
      const normalizedRole = role.toLowerCase();
      if (normalizedRole === "assistant" || normalizedRole === "ai" || normalizedRole === "bot") {
        return "assistant";
      }
      if (normalizedRole === "user" || normalizedRole === "human") {
        return "user";
      }
      if (normalizedRole === "system") {
        return "system";
      }
      if (normalizedRole === "tool" || normalizedRole === "function") {
        return "tool";
      }
      return "unknown";
    }
    /**
     * 从消息中提取内容块
     * 
     * 处理 content 可能是字符串或对象数组的情况
     * 
     * @param msg 通义千问消息
     * @returns 内容块列表
     */
    extractMessageBlocks(msg) {
      const blocks = [];
      const content = msg.content;
      if (typeof content === "string") {
        blocks.push({
          type: "text",
          text: content
        });
      } else if (Array.isArray(content)) {
        for (const part of content) {
          const block = this.extractBlockContent(part);
          if (block) {
            blocks.push(block);
          }
        }
      } else if (typeof content === "object" && content !== null) {
        const block = this.extractBlockContent(content);
        if (block) {
          blocks.push(block);
        }
      }
      return blocks;
    }
    /**
     * 提取单个内容块
     * 
     * 支持多种块类型：
     * - text: 普通文本
     * - code: 代码块
     * - image: 图片
     * - file: 文件附件
     * - link: 链接
     * - plugin: 插件执行结果（通义千问特有）
     * - unsupported: 不支持的类型
     * 
     * @param part 内容部分
     * @returns 提取的内容块
     */
    extractBlockContent(part) {
      const type = (part.type || "text").toLowerCase();
      if (type === "text" || !part.type) {
        return {
          type: "text",
          text: this.adjustHeaderLevels(part.text || part.content || String(part), 1)
        };
      }
      if (type === "code") {
        return {
          type: "code",
          text: part.text || part.content || part.code || "",
          metadata: {
            language: part.language || part.lang || ""
          }
        };
      }
      if (type === "image") {
        return {
          type: "image",
          text: part.url || part.src || part.data || "",
          metadata: {
            alt: part.alt || part.title || ""
          }
        };
      }
      if (type === "file" || type === "attachment") {
        return {
          type: "file",
          text: part.url || part.path || "",
          title: part.name || part.filename || part.title || "Attachment",
          metadata: {
            mimeType: part.mimeType || part.type || "",
            size: part.size
          }
        };
      }
      if (type === "link" || type === "url") {
        return {
          type: "link",
          text: part.url || part.href || part.link || "",
          title: part.title || part.name || "",
          metadata: {
            description: part.description || part.snippet || ""
          }
        };
      }
      if (type === "plugin" || type === "tool_result") {
        return {
          type: "plugin",
          text: part.result || part.output || part.text || "Plugin executed",
          metadata: {
            pluginName: part.plugin_name || part.name || "",
            pluginType: part.plugin_type || ""
          }
        };
      }
      const text = part.text || part.content || part.msg || String(part);
      if (text) {
        return {
          type: "unsupported",
          text: `[${type}] ${text}`,
          metadata: {
            originalType: part.type,
            originalPart: part
          }
        };
      }
      return null;
    }
    /**
     * 从原始数据中提取消息列表
     * 
     * 支持多种数据结构：
     * - messages 数组
     * - chats 数组
     * - turns 数组
     * - history 数组（通义千问可能使用）
     * - mapping 对象
     * 
     * @param data 通义千问原始对话数据
     * @returns 消息列表
     */
    extractMessagesFromData(data) {
      var _a, _b, _c;
      if (Array.isArray(data.messages)) {
        return data.messages;
      }
      if (Array.isArray(data.chats)) {
        return data.chats;
      }
      if (Array.isArray(data.turns)) {
        return data.turns;
      }
      if (Array.isArray(data.history)) {
        return data.history;
      }
      if (data.mapping) {
        return this.extractMessagesFromMapping(data.mapping);
      }
      if ((_a = data.data) == null ? void 0 : _a.messages) {
        return data.data.messages;
      }
      if ((_b = data.result) == null ? void 0 : _b.messages) {
        return data.result.messages;
      }
      if ((_c = data.response) == null ? void 0 : _c.messages) {
        return data.response.messages;
      }
      return [];
    }
    /**
     * 从 mapping 结构中提取消息
     * 
     * @param mapping 通义千问 mapping 对象
     * @returns 消息列表
     */
    extractMessagesFromMapping(mapping) {
      const messages = [];
      for (const key of Object.keys(mapping)) {
        const node = mapping[key];
        if (node == null ? void 0 : node.message) {
          messages.push(node.message);
        }
      }
      return messages;
    }
    /**
     * 调整 Markdown 标题级别
     * 
     * 将所有标题级别增加 1 级，避免与对话标题冲突
     * 
     * @param text 原始文本
     * @param increaseBy 增加的级别数
     * @returns 调整后的文本
     */
    adjustHeaderLevels(text, increaseBy = 1) {
      if (!text) return "";
      return String(text).replace(/^(#+)(\s*)(.*?)\s*$/gm, (_m, hashes, _space, content) => {
        return "#".repeat(hashes.length + increaseBy) + " " + String(content).trim();
      });
    }
    /**
     * 生成消息 ID
     * 
     * @param conversationId 对话 ID
     * @param messageId 原始消息 ID
     * @returns 生成的唯一 ID
     */
    generateMessageId(conversationId, messageId) {
      const id = messageId || Date.now().toString();
      return `${conversationId}_msg_${id}`;
    }
    /**
     * 统计参与者数量
     * 
     * @param messages 消息列表
     * @returns 参与者数量
     */
    countParticipants(messages) {
      const roles = new Set(messages.map((m) => m.role));
      return roles.size;
    }
  }
  const normalizerRegistry = /* @__PURE__ */ new Map();
  normalizerRegistry.set("yuanbao", YuanbaoNormalizer);
  normalizerRegistry.set("chatgpt", ChatGPTRNormalizer);
  normalizerRegistry.set("doubao", DoubaoNormalizer);
  normalizerRegistry.set("kimi", KimiNormalizer);
  normalizerRegistry.set("claude", ClaudeNormalizer);
  normalizerRegistry.set("deepseek", DeepSeekNormalizer);
  normalizerRegistry.set("qwen", QwenNormalizer);
  function getNormalizer(platform) {
    const NormalizerClass = normalizerRegistry.get(platform);
    if (!NormalizerClass) {
      console.warn(`[NormalizerRegistry] No normalizer found for ${platform}`);
      return null;
    }
    return new NormalizerClass();
  }
  class BaseExporter {
    /**
     * 批量导出
     * 默认实现：逐个导出
     */
    async exportAll(conversations, options) {
      var _a;
      console.log(`[${this.format}] Exporting ${conversations.length} conversations`);
      let successCount = 0;
      let totalMessages = 0;
      let lastError;
      for (const conv of conversations) {
        try {
          const result = await this.exportConversation(conv, options);
          if (result.success) {
            successCount++;
            totalMessages += ((_a = result.stats) == null ? void 0 : _a.messageCount) || 0;
          } else {
            lastError = result.error;
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          console.error(`[${this.format}] Failed to export conversation:`, error);
        }
      }
      return {
        success: successCount === conversations.length,
        stats: {
          messageCount: totalMessages,
          conversationCount: successCount
        },
        error: lastError
      };
    }
    /**
     * 生成文件名
     * 默认实现：使用对话 ID 和时间戳
     */
    generateFilename(conversation, extension) {
      const title = conversation.title || "conversation";
      const safeTitle = title.replace(/[^a-z0-9]/gi, "_").substring(0, 50);
      const timestamp = new Date(conversation.updatedAt).toISOString().split("T")[0];
      return `${safeTitle}_${timestamp}.${extension}`;
    }
    /**
     * 辅助方法：将数据转换为 Blob
     * 在 Node.js 环境中返回 null
     */
    createBlob(data, mimeType = "text/plain") {
      if (typeof Blob === "undefined") {
        return null;
      }
      return new Blob([data], { type: mimeType });
    }
    /**
     * 辅助方法：触发下载
     * 在 Node.js 环境中安全跳过
     */
    triggerDownload(blob, filename) {
      if (!blob || typeof URL === "undefined" || typeof document === "undefined") {
        return;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    /**
     * 辅助方法：确保目录存在（浏览器环境有限支持）
     */
    async ensureDir(dirPath) {
      console.log(`[Exporter] ensureDir (stub): ${dirPath}`);
    }
    /**
     * 辅助方法：写入文件
     */
    async writeFile(_path) {
      console.log("[Exporter] writeFile (stub)");
    }
  }
  class JSONExporter extends BaseExporter {
    constructor() {
      super(...arguments);
      __publicField(this, "format", "json");
    }
    async exportConversation(conversation, options) {
      try {
        const exportData = options.includeMetadata ? conversation : {
          id: conversation.id,
          title: conversation.title,
          messages: conversation.messages,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        };
        const jsonContent = JSON.stringify(exportData, null, 2);
        const filename = options.filename || this.generateFilename(conversation, "json");
        const blob = this.createBlob(jsonContent, "application/json");
        this.triggerDownload(blob, filename);
        if (!blob) {
          console.log(`[JSONExporter] Generated: ${filename} (${jsonContent.length} bytes)`);
        }
        return {
          success: true,
          outputPath: filename,
          stats: {
            messageCount: conversation.messages.length,
            conversationCount: 1
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stats: {
            messageCount: 0,
            conversationCount: 0
          }
        };
      }
    }
  }
  class MarkdownExporter extends BaseExporter {
    constructor() {
      super(...arguments);
      __publicField(this, "format", "markdown");
    }
    /**
     * 导出单个对话为 Markdown
     */
    async exportConversation(conversation, options) {
      try {
        const markdownContent = this.renderConversation(conversation, options);
        const filename = options.filename || this.generateFilename(conversation, "md");
        const blob = this.createBlob(markdownContent, "text/markdown");
        this.triggerDownload(blob, filename);
        if (!blob) {
          console.log(`[MarkdownExporter] Generated: ${filename} (${markdownContent.length} bytes)`);
        }
        return {
          success: true,
          outputPath: filename,
          stats: {
            messageCount: conversation.messages.length,
            conversationCount: 1
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stats: {
            messageCount: 0,
            conversationCount: 0
          }
        };
      }
    }
    /** Generate Markdown without triggering a browser download. */
    renderConversation(conversation, options = { format: "markdown" }) {
      return this.generateMarkdown(conversation, options);
    }
    /**
     * 生成 Markdown 内容
     * 
     * 支持两种格式：
     * - V1: 简洁风格，与 yuanbaoToMarkdown() 输出一致
     * - V2: 增强风格，包含元数据和结构化信息
     */
    generateMarkdown(conversation, options) {
      const formatVersion = options.formatVersion || "v2";
      if (formatVersion === "v1") {
        return this.generateMarkdownV1(conversation, options);
      }
      return this.generateMarkdownV2(conversation, options);
    }
    /**
     * 生成 V1 格式 Markdown（与 yuanbaoToMarkdown 一致）
     * 
     * V1 格式特点：
     * - 简洁，无元数据部分
     * - 消息使用 `## 角色 (Turn N)` 格式
     * - 时间戳使用 `*时间戳*` 斜体格式
     * - think 块使用 `> [Think] 标题` 格式
     */
    generateMarkdownV1(conversation, options) {
      const lines = [];
      lines.push(`# ${conversation.title || "对话导出"}`);
      lines.push("");
      lines.push(`> Exported at: ${this.formatTimestampV1(Date.now())}`);
      lines.push("");
      for (let i = 0; i < conversation.messages.length; i++) {
        const message = conversation.messages[i];
        const messageLines = this.formatMessageV1(message, i, options);
        lines.push(...messageLines);
      }
      return lines.join("\n") + "\n";
    }
    /**
     * 生成 V2 格式 Markdown（增强风格）
     * 
     * V2 格式特点：
     * - 包含元数据部分
     * - 消息使用 `### 第 N 轮 - 角色` 格式
     * - 时间戳使用 `> 时间：时间戳` 引用格式
     * - think 块使用 `> **思考过程:**` 格式
     */
    generateMarkdownV2(conversation, options) {
      var _a;
      const lines = [];
      lines.push(`# ${conversation.title || "对话导出"}`);
      lines.push("");
      if (options.includeMetadata) {
        lines.push("## 元数据");
        lines.push("");
        lines.push(`- **ID**: ${conversation.id}`);
        lines.push(`- **创建时间**: ${this.formatTimestamp(conversation.createdAt)}`);
        lines.push(`- **更新时间**: ${this.formatTimestamp(conversation.updatedAt)}`);
        lines.push(`- **消息数**: ${conversation.messages.length}`);
        if ((_a = conversation.metadata) == null ? void 0 : _a.platform) {
          lines.push(`- **平台**: ${conversation.metadata.platform}`);
        }
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      lines.push("## 对话内容");
      lines.push("");
      for (let i = 0; i < conversation.messages.length; i++) {
        const message = conversation.messages[i];
        const messageLines = this.formatMessage(message, i + 1, options);
        lines.push(...messageLines);
      }
      if (options.includeMetadata) {
        lines.push("---");
        lines.push("");
        lines.push(`*导出时间：${this.formatTimestamp(Date.now())}*`);
        lines.push(`*由 Chat Export Toolkit V2 生成*`);
      }
      return lines.join("\n");
    }
    /**
     * 格式化单条消息（V2 格式）
     * 
     * V2 格式：
     * - 轮次：`### 第 N 轮 - 角色`
     * - 时间戳：`> 时间：时间戳`
     * - think 块：`> **思考过程:**`
     */
    formatMessage(message, index, options) {
      var _a;
      const lines = [];
      const roleLabel = this.getRoleLabel(message.role);
      const timestamp = this.formatTimestamp(message.timestamp);
      lines.push(`### 第 ${index} 轮 - ${roleLabel}`);
      lines.push("");
      lines.push(`> 时间：${timestamp}`);
      lines.push("");
      const content = message.content.text;
      if (content.includes("<think>") || content.includes("```think")) {
        const thinkLines = this.formatThinkBlock(content);
        lines.push(...thinkLines);
      } else {
        lines.push(content);
      }
      lines.push("");
      if (options.includeAttachments && ((_a = message.content.attachments) == null ? void 0 : _a.length)) {
        lines.push("**附件:**");
        for (const attachment of message.content.attachments) {
          lines.push(`- [${attachment.name || "附件"}](${attachment.url || "#"})`);
        }
        lines.push("");
      }
      lines.push("---");
      lines.push("");
      return lines;
    }
    /**
     * 格式化单条消息（V1 格式）
     * 
     * V1 格式（与 yuanbaoToMarkdown 一致）：
     * - 轮次：`## 角色 (Turn N)`
     * - 时间戳：`*时间戳*`
     * - think 块：`> [Think] 标题`
     */
    formatMessageV1(message, index, _options) {
      const lines = [];
      const roleLabel = this.getRoleLabelV1(message.role);
      lines.push(`## ${roleLabel} (Turn ${index})`);
      const timestamp = this.formatTimestampV1(message.timestamp);
      lines.push(`*${timestamp}*`);
      lines.push("");
      const content = message.content.text;
      const contentLines = this.formatContentV1(content);
      lines.push(...contentLines);
      lines.push("");
      lines.push("---");
      lines.push("");
      return lines;
    }
    /**
     * 格式化内容（V1 格式）
     * 
     * 处理 think 块，使用 V1 格式：
     * - `> [Think] 标题`
     * - `> 内容`
     */
    formatContentV1(content) {
      const lines = [];
      const thinkRegex = /<think>([\s\S]*?)<\/think>|```think([\s\S]*?)```/g;
      let match;
      let lastIndex = 0;
      while ((match = thinkRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          const beforeText = content.slice(lastIndex, match.index).trim();
          if (beforeText) {
            lines.push(beforeText);
            lines.push("");
          }
        }
        const thinkContent = (match[1] || match[2] || "").trim();
        lines.push("> [Think]");
        for (const line of thinkContent.split("\n")) {
          lines.push(`> ${line}`);
        }
        lines.push("");
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < content.length) {
        const remainingText = content.slice(lastIndex).trim();
        if (remainingText) {
          lines.push(remainingText);
        }
      }
      return lines;
    }
    /**
     * 格式化 think 块
     * 
     * TODO: 从 V1 迁移完整的 think 块处理逻辑
     * V1 中 think 块可能有特殊标记，需要保留原始格式
     */
    formatThinkBlock(content) {
      const lines = [];
      const thinkRegex = /<think>([\s\S]*?)<\/think>|```think([\s\S]*?)```/g;
      let match;
      let lastIndex = 0;
      while ((match = thinkRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          const beforeText = content.slice(lastIndex, match.index).trim();
          if (beforeText) {
            lines.push(beforeText);
            lines.push("");
          }
        }
        const thinkContent = (match[1] || match[2] || "").trim();
        lines.push("> **思考过程:**");
        lines.push(">");
        for (const line of thinkContent.split("\n")) {
          lines.push(`> ${line}`);
        }
        lines.push("");
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < content.length) {
        const remainingText = content.slice(lastIndex).trim();
        if (remainingText) {
          lines.push(remainingText);
        }
      }
      return lines;
    }
    /**
     * 获取角色标签（V2 格式）
     * 
     * V2 使用中文标签
     */
    getRoleLabel(role) {
      const roleMap = {
        "user": "用户",
        "assistant": "助手",
        "system": "系统",
        "tool": "工具",
        "unknown": "未知"
      };
      return roleMap[role] || role;
    }
    /**
     * 获取角色标签（V1 格式）
     * 
     * V1 使用英文标签（与 yuanbaoToMarkdown 一致）
     */
    getRoleLabelV1(role) {
      const roleMap = {
        "user": "User",
        "assistant": "Assistant",
        "system": "System",
        "tool": "Tool",
        "unknown": "Unknown"
      };
      return roleMap[role] || role;
    }
    /**
     * 格式化时间戳（V2 格式）
     * 
     * 格式：YYYY-MM-DD HH:mm:ss
     */
    formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const seconds = String(date.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    /**
     * 格式化时间戳（V1 格式）
     * 
     * V1 使用 toLocaleString() 默认格式（与 yuanbaoToMarkdown 一致）
     * 格式示例：3/19/2024, 5:20:00 PM
     */
    formatTimestampV1(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      });
    }
    /**
     * 重写文件名生成逻辑
     * 
     * V1/V2 使用相同的文件名格式：
     * 标题_日期.扩展名
     */
    generateFilename(conversation, extension) {
      const title = conversation.title || "conversation";
      const safeTitle = title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, "_").substring(0, 50);
      const timestamp = new Date(conversation.updatedAt).toISOString().split("T")[0];
      return `${safeTitle}_${timestamp}.${extension}`;
    }
  }
  class DocxExporter extends BaseExporter {
    constructor() {
      super(...arguments);
      __publicField(this, "format", "docx");
    }
    /**
     * 导出单个对话为 DOCX
     */
    async exportConversation(conversation, options) {
      try {
        const JSZip = globalThis.JSZip;
        if (!JSZip) {
          console.log("[DocxExporter] JSZip not available, skipping DOCX generation");
          const filename2 = options.filename || this.generateFilename(conversation, "docx");
          return {
            success: false,
            error: "JSZip not available. DOCX export requires browser environment with JSZip loaded.",
            outputPath: filename2,
            stats: {
              messageCount: conversation.messages.length,
              conversationCount: 1
            }
          };
        }
        const docxBlob = await this.generateDocx(conversation, options);
        const filename = options.filename || this.generateFilename(conversation, "docx");
        this.triggerDownload(docxBlob, filename);
        return {
          success: true,
          outputPath: filename,
          stats: {
            messageCount: conversation.messages.length,
            conversationCount: 1
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stats: {
            messageCount: 0,
            conversationCount: 0
          }
        };
      }
    }
    /**
     * 生成 DOCX 文件
     * 
     * TODO: 从 V1 迁移 buildDocxBlob() 的完整逻辑
     * TODO: 确保输出的 DOCX 结构与 V1 一致
     */
    async generateDocx(conversation, options) {
      const JSZip = window.JSZip;
      if (!JSZip) {
        throw new Error("JSZip not available. Make sure to include JSZip via @require in userscript.");
      }
      const zip = new JSZip();
      zip.file("[Content_Types].xml", this.generateContentTypesXml());
      zip.folder("_rels").file(".rels", this.generateRelsXml());
      const documentXml = this.generateDocumentXml(conversation, options);
      zip.folder("word").file("document.xml", documentXml);
      const stylesXml = this.generateStylesXml();
      zip.folder("word").file("styles.xml", stylesXml);
      zip.folder("word").folder("_rels").file("document.xml.rels", this.generateDocumentRelsXml());
      const blob = await zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
      });
      return blob;
    }
    /**
     * 生成 [Content_Types].xml
     * 
     * TODO: 从 V1 迁移，确保与 V1 一致
     */
    generateContentTypesXml() {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    }
    /**
     * 生成 _rels/.rels
     * 
     * TODO: 从 V1 迁移，确保与 V1 一致
     */
    generateRelsXml() {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    }
    /**
     * 生成 word/document.xml（主文档内容）
     * 
     * 支持两种格式：
     * - V1: 简洁风格，无元数据部分
     * - V2: 增强风格，包含元数据
     */
    generateDocumentXml(conversation, options) {
      const formatVersion = options.formatVersion || "v2";
      const paragraphs = [];
      paragraphs.push(this.createTitleParagraph(conversation.title || "对话导出"));
      if (formatVersion === "v2") {
        if (options.includeMetadata) {
          paragraphs.push(...this.createMetadataParagraphs(conversation));
        }
        for (let i = 0; i < conversation.messages.length; i++) {
          const message = conversation.messages[i];
          const messageParagraphs = this.createMessageParagraphs(message, i + 1, options);
          paragraphs.push(...messageParagraphs);
        }
        if (options.includeMetadata) {
          paragraphs.push(this.createFooterParagraph());
        }
      } else {
        for (let i = 0; i < conversation.messages.length; i++) {
          const message = conversation.messages[i];
          const messageParagraphs = this.createMessageParagraphsV1(message, i, options);
          paragraphs.push(...messageParagraphs);
        }
      }
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11900" w:h="16840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
    }
    /**
     * 创建标题段落
     * 
     * TODO: 从 V1 迁移标题样式
     */
    createTitleParagraph(title) {
      return `
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
        <w:jc w:val="center"/>
      </w:pPr>
      <w:r>
        <w:t>${this.escapeXml(title)}</w:t>
      </w:r>
    </w:p>`;
    }
    /**
     * 创建元数据段落
     * 
     * TODO: 从 V1 迁移元数据格式
     */
    createMetadataParagraphs(conversation) {
      var _a;
      const paragraphs = [];
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Subtitle"/>
      </w:pPr>
      <w:r>
        <w:t>对话 ID: ${this.escapeXml(conversation.id)}</w:t>
      </w:r>
    </w:p>`);
      paragraphs.push(`
    <w:p>
      <w:r>
        <w:t>创建时间：${this.escapeXml(this.formatTimestamp(conversation.createdAt))}</w:t>
      </w:r>
    </w:p>`);
      paragraphs.push(`
    <w:p>
      <w:r>
        <w:t>更新时间：${this.escapeXml(this.formatTimestamp(conversation.updatedAt))}</w:t>
      </w:r>
    </w:p>`);
      paragraphs.push(`
    <w:p>
      <w:r>
        <w:t>消息数：${conversation.messages.length}</w:t>
      </w:r>
    </w:p>`);
      if ((_a = conversation.metadata) == null ? void 0 : _a.platform) {
        paragraphs.push(`
    <w:p>
      <w:r>
        <w:t>平台：${this.escapeXml(conversation.metadata.platform)}</w:t>
      </w:r>
    </w:p>`);
      }
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:pStyle w:val="HorizontalLine"/>
      </w:pPr>
    </w:p>`);
      return paragraphs;
    }
    /**
     * 创建消息段落（V2 格式）
     * 
     * V2 格式：
     * - 轮次：`第 N 轮 - 角色`（中文）
     * - 时间戳：`时间：时间戳`
     * - think 块：`思考过程:`
     */
    createMessageParagraphs(message, index, options) {
      var _a;
      const paragraphs = [];
      const roleLabel = this.getRoleLabel(message.role);
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Heading3"/>
        <w:spacing w:before="240" w:after="120"/>
      </w:pPr>
      <w:r>
        <w:t>第 ${index} 轮 - ${this.escapeXml(roleLabel)}</w:t>
      </w:r>
    </w:p>`);
      const timestamp = this.formatTimestamp(message.timestamp);
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:ind w:left="720"/>
        <w:i/>
      </w:pPr>
      <w:r>
        <w:t>时间：${this.escapeXml(timestamp)}</w:t>
      </w:r>
    </w:p>`);
      const content = message.content.text;
      if (content.includes("<think>") || content.includes("```think")) {
        const thinkParagraphs = this.createThinkBlockParagraphs(content);
        paragraphs.push(...thinkParagraphs);
      } else {
        paragraphs.push(...this.createContentParagraphs(content));
      }
      if (options.includeAttachments && ((_a = message.content.attachments) == null ? void 0 : _a.length)) {
        paragraphs.push(`
    <w:p>
      <w:r>
        <w:rPr>
          <w:b/>
        </w:rPr>
        <w:t>附件:</w:t>
      </w:r>
    </w:p>`);
        for (const attachment of message.content.attachments) {
          paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:ind w:left="720"/>
      </w:pPr>
      <w:r>
        <w:t>• ${this.escapeXml(attachment.name || "附件")}: ${this.escapeXml(attachment.url || "")}</w:t>
      </w:r>
    </w:p>`);
        }
      }
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:pStyle w:val="HorizontalLine"/>
      </w:pPr>
    </w:p>`);
      return paragraphs;
    }
    /**
     * 创建消息段落（V1 格式）
     * 
     * V1 格式：
     * - 轮次：`Role (Turn N)`（英文）
     * - 时间戳：斜体
     * - think 块：`[Think]`
     */
    createMessageParagraphsV1(message, index, options) {
      var _a;
      const paragraphs = [];
      const roleLabel = this.getRoleLabelV1(message.role);
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Heading2"/>
        <w:spacing w:before="200" w:after="100"/>
      </w:pPr>
      <w:r>
        <w:t>${this.escapeXml(roleLabel)} (Turn ${index})</w:t>
      </w:r>
    </w:p>`);
      const timestamp = this.formatTimestampV1(message.timestamp);
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:i/>
      </w:pPr>
      <w:r>
        <w:t>${this.escapeXml(timestamp)}</w:t>
      </w:r>
    </w:p>`);
      const content = message.content.text;
      if (content.includes("<think>") || content.includes("```think")) {
        const thinkParagraphs = this.createThinkBlockParagraphsV1(content);
        paragraphs.push(...thinkParagraphs);
      } else {
        paragraphs.push(...this.createContentParagraphs(content));
      }
      if (options.includeAttachments && ((_a = message.content.attachments) == null ? void 0 : _a.length)) {
        paragraphs.push(`
    <w:p>
      <w:r>
        <w:rPr>
          <w:b/>
        </w:rPr>
        <w:t>Attachments:</w:t>
      </w:r>
    </w:p>`);
        for (const attachment of message.content.attachments) {
          paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:ind w:left="720"/>
      </w:pPr>
      <w:r>
        <w:t>• ${this.escapeXml(attachment.name || "Attachment")}: ${this.escapeXml(attachment.url || "")}</w:t>
      </w:r>
    </w:p>`);
        }
      }
      paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:pStyle w:val="HorizontalLine"/>
      </w:pPr>
    </w:p>`);
      return paragraphs;
    }
    /**
     * 创建 think 块段落（V2 格式）
     * 
     * V2 格式：`思考过程:`
     */
    createThinkBlockParagraphs(content) {
      const paragraphs = [];
      const thinkRegex = /<think>([\s\S]*?)<\/think>|```think([\s\S]*?)```/g;
      let match;
      let lastIndex = 0;
      while ((match = thinkRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          const beforeText = content.slice(lastIndex, match.index).trim();
          if (beforeText) {
            paragraphs.push(...this.createContentParagraphs(beforeText));
          }
        }
        const thinkContent = (match[1] || match[2] || "").trim();
        paragraphs.push(`
    <w:p>
      <w:r>
        <w:rPr>
          <w:b/>
        </w:rPr>
        <w:t>思考过程:</w:t>
      </w:r>
    </w:p>`);
        for (const line of thinkContent.split("\n")) {
          if (line.trim()) {
            paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:ind w:left="720"/>
        <w:i/>
      </w:pPr>
      <w:r>
        <w:t>${this.escapeXml(line)}</w:t>
      </w:r>
    </w:p>`);
          }
        }
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < content.length) {
        const remainingText = content.slice(lastIndex).trim();
        if (remainingText) {
          paragraphs.push(...this.createContentParagraphs(remainingText));
        }
      }
      return paragraphs;
    }
    /**
     * 创建 think 块段落（V1 格式）
     * 
     * V1 格式：`[Think]`
     */
    createThinkBlockParagraphsV1(content) {
      const paragraphs = [];
      const thinkRegex = /<think>([\s\S]*?)<\/think>|```think([\s\S]*?)```/g;
      let match;
      let lastIndex = 0;
      while ((match = thinkRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          const beforeText = content.slice(lastIndex, match.index).trim();
          if (beforeText) {
            paragraphs.push(...this.createContentParagraphs(beforeText));
          }
        }
        const thinkContent = (match[1] || match[2] || "").trim();
        paragraphs.push(`
    <w:p>
      <w:r>
        <w:rPr>
          <w:b/>
        </w:rPr>
        <w:t>[Think]</w:t>
      </w:r>
    </w:p>`);
        for (const line of thinkContent.split("\n")) {
          if (line.trim()) {
            paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:ind w:left="720"/>
        <w:i/>
      </w:pPr>
      <w:r>
        <w:t>${this.escapeXml(line)}</w:t>
      </w:r>
    </w:p>`);
          }
        }
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < content.length) {
        const remainingText = content.slice(lastIndex).trim();
        if (remainingText) {
          paragraphs.push(...this.createContentParagraphs(remainingText));
        }
      }
      return paragraphs;
    }
    /**
     * 创建普通内容段落
     * 
     * TODO: 处理长文本自动换行、代码块等特殊格式
     */
    createContentParagraphs(content) {
      const paragraphs = [];
      const lines = content.split("\n\n");
      for (const line of lines) {
        if (line.trim()) {
          const text = line.replace(/\n/g, " ");
          paragraphs.push(`
    <w:p>
      <w:pPr>
        <w:spacing w:after="120"/>
      </w:pPr>
      <w:r>
        <w:t>${this.escapeXml(text)}</w:t>
      </w:r>
    </w:p>`);
        }
      }
      return paragraphs;
    }
    /**
     * 创建页脚段落
     */
    createFooterParagraph() {
      const timestamp = this.formatTimestamp(Date.now());
      return `
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:i/>
      </w:pPr>
      <w:r>
        <w:t>导出时间：${this.escapeXml(timestamp)} | 由 Chat Export Toolkit V2 生成</w:t>
      </w:r>
    </w:p>`;
    }
    /**
     * 生成 word/styles.xml（样式定义）
     * 
     * TODO: 从 V1 迁移样式定义，确保与 V1 一致
     */
    generateStylesXml() {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <!-- 默认样式 -->
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>

  <!-- 标题样式 -->
  <w:style w:type="paragraph" w:styleId="Title" w:default="1">
    <w:name w:val="Title"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="36"/>
      <w:szCs w:val="36"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:rPr>
      <w:i/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="Heading 3"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
      <w:color w:val="2E74B5"/>
    </w:rPr>
  </w:style>

  <!-- 分隔线样式 -->
  <w:style w:type="paragraph" w:styleId="HorizontalLine">
    <w:name w:val="Horizontal Line"/>
    <w:pPr>
      <w:spacing w:before="120" w:after="120"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="4"/>
    </w:rPr>
  </w:style>
</w:styles>`;
    }
    /**
     * 生成 word/_rels/document.xml.rels
     */
    generateDocumentRelsXml() {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
    }
    /**
     * XML 转义
     */
    escapeXml(text) {
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    }
    /**
     * 格式化时间戳（V2 格式）
     * 
     * 格式：YYYY-MM-DD HH:mm:ss
     */
    formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const seconds = String(date.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    /**
     * 格式化时间戳（V1 格式）
     * 
     * V1 使用 toLocaleString() 默认格式（与 yuanbaoToMarkdown 一致）
     * 格式示例：3/19/2024, 5:20:00 PM
     */
    formatTimestampV1(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      });
    }
    /**
     * 获取角色标签（V2 格式）
     * 
     * V2 使用中文标签
     */
    getRoleLabel(role) {
      const roleMap = {
        "user": "用户",
        "assistant": "助手",
        "system": "系统",
        "tool": "工具",
        "unknown": "未知"
      };
      return roleMap[role] || role;
    }
    /**
     * 获取角色标签（V1 格式）
     * 
     * V1 使用英文标签
     */
    getRoleLabelV1(role) {
      const roleMap = {
        "user": "User",
        "assistant": "Assistant",
        "system": "System",
        "tool": "Tool",
        "unknown": "Unknown"
      };
      return roleMap[role] || role;
    }
    /**
     * 重写文件名生成逻辑
     * 
     * V1/V2 使用相同的文件名格式
     */
    generateFilename(conversation, extension) {
      const title = conversation.title || "conversation";
      const safeTitle = title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, "_").substring(0, 50);
      const timestamp = new Date(conversation.updatedAt).toISOString().split("T")[0];
      return `${safeTitle}_${timestamp}.${extension}`;
    }
  }
  class ZIPExporter extends BaseExporter {
    constructor() {
      super(...arguments);
      __publicField(this, "format", "zip");
    }
    /**
     * 批量导出对话为 ZIP
     * 
     * @param conversations 对话列表
     * @param options 导出选项
     * @returns 导出结果
     */
    async exportAll(conversations, options) {
      try {
        const JSZip = globalThis.JSZip;
        if (!JSZip) {
          console.log("[ZIPExporter] JSZip not available, skipping ZIP generation");
          return {
            success: false,
            error: "JSZip not available. ZIP export requires browser environment with JSZip loaded.",
            stats: { messageCount: 0, conversationCount: 0 }
          };
        }
        if (conversations.length === 0) {
          return {
            success: false,
            error: "No conversations to export",
            stats: { messageCount: 0, conversationCount: 0 }
          };
        }
        const zip = new JSZip();
        if (options.bundleBothFormats) {
          return await this.exportBackupBundle(zip, conversations, options);
        }
        const format = options.format || "json";
        const exporter = this.getExporterForFormat(format);
        if (!exporter) {
          return {
            success: false,
            error: `Unsupported format for ZIP export: ${format}`,
            stats: { messageCount: 0, conversationCount: 0 }
          };
        }
        const extensionMap = {
          json: "json",
          markdown: "md",
          docx: "docx"
        };
        const extension = extensionMap[format] || "txt";
        console.log(`[ZIPExporter] Exporting ${conversations.length} conversations as ${format}...`);
        let totalMessages = 0;
        let successCount = 0;
        const errors = [];
        for (let i = 0; i < conversations.length; i++) {
          const conversation = conversations[i];
          try {
            const filename = this.generateConversationFilename(
              conversation,
              extension,
              i,
              conversations.length
            );
            const content = await this.generateContent(exporter, conversation, options);
            zip.file(filename, content);
            successCount++;
            totalMessages += conversation.messages.length;
            console.log(`[ZIPExporter] Added: ${filename} (${conversation.messages.length} messages)`);
          } catch (error) {
            const errorMsg = `Failed to export conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            console.error(`[ZIPExporter] ${errorMsg}`);
          }
        }
        if (options.includeMetadata !== false) {
          const metadata = {
            exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
            format,
            conversationCount: successCount,
            totalMessages,
            conversations: conversations.map((conv, index) => ({
              id: conv.id,
              title: conv.title || `Conversation ${index + 1}`,
              messageCount: conv.messages.length,
              createdAt: conv.createdAt,
              updatedAt: conv.updatedAt,
              filename: this.generateConversationFilename(conv, extension, index, conversations.length)
            }))
          };
          zip.file("metadata.json", JSON.stringify(metadata, null, 2));
        }
        const zipBlob = await zip.generateAsync({
          type: "blob",
          mimeType: "application/zip",
          compression: "DEFLATE",
          compressionOptions: { level: 6 }
        });
        const zipFilename = this.generateZipFilename(format);
        this.triggerDownload(zipBlob, zipFilename);
        console.log(`[ZIPExporter] Export complete: ${zipFilename} (${successCount}/${conversations.length} conversations)`);
        return {
          success: successCount === conversations.length,
          outputPath: zipFilename,
          stats: {
            messageCount: totalMessages,
            conversationCount: successCount
          },
          error: errors.length > 0 ? errors.join("; ") : void 0
        };
      } catch (error) {
        console.error("[ZIPExporter] Export failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stats: {
            messageCount: 0,
            conversationCount: 0
          }
        };
      }
    }
    /** Emit the full-backup layout: raw JSON plus normalized Markdown. */
    async exportBackupBundle(zip, conversations, options) {
      var _a;
      const rawById = /* @__PURE__ */ new Map();
      for (const raw of options.rawConversations || []) {
        const data = raw.data;
        const id = this.extractRawConversationId(data);
        if (id) rawById.set(id, data);
      }
      let totalMessages = 0;
      const files = [];
      for (let index = 0; index < conversations.length; index++) {
        const conversation = conversations[index];
        const jsonFilename = this.generateConversationFilename(
          conversation,
          "json",
          index,
          conversations.length
        );
        const markdownFilename = jsonFilename.replace(/\.json$/i, ".md");
        const rawData = rawById.get(conversation.id) ?? ((_a = conversation.metadata) == null ? void 0 : _a.originalData) ?? conversation;
        zip.file(`json/${jsonFilename}`, JSON.stringify(rawData, null, 2));
        zip.file(
          `markdown/${markdownFilename}`,
          this.generateSimpleMarkdown(conversation, options)
        );
        totalMessages += conversation.messages.length;
        files.push({
          id: conversation.id,
          title: conversation.title,
          json: `json/${jsonFilename}`,
          markdown: `markdown/${markdownFilename}`,
          messageCount: conversation.messages.length,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        });
      }
      const metadata = {
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        platform: options.platformName,
        format: "raw-json+markdown",
        conversationCount: conversations.length,
        totalMessages,
        files,
        warnings: options.exportWarnings || []
      };
      zip.file("metadata.json", JSON.stringify(metadata, null, 2));
      const zipBlob = await zip.generateAsync({
        type: "blob",
        mimeType: "application/zip",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
      const zipFilename = this.generateZipFilename("bundle", options.platformName);
      this.triggerDownload(zipBlob, zipFilename);
      return {
        success: true,
        outputPath: zipFilename,
        stats: {
          messageCount: totalMessages,
          conversationCount: conversations.length
        }
      };
    }
    extractRawConversationId(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return "";
      const record = value;
      for (const key of ["conversationId", "conversation_id", "convId", "conversationUuid", "sessionId", "chatId", "id"]) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate) return candidate;
        if (typeof candidate === "number") return String(candidate);
      }
      return "";
    }
    /**
     * 导出单个对话（不支持，必须批量导出）
     */
    async exportConversation(_conversation, _options) {
      return {
        success: false,
        error: "ZIPExporter requires multiple conversations. Use exportAll() instead.",
        stats: { messageCount: 0, conversationCount: 0 }
      };
    }
    /**
     * 根据格式获取对应的导出器
     */
    getExporterForFormat(format) {
      switch (format) {
        case "json":
          return new JSONExporter();
        case "markdown":
          return new MarkdownExporter();
        case "docx":
          return new DocxExporter();
        default:
          return null;
      }
    }
    /**
     * 使用导出器生成内容字符串
     */
    async generateContent(exporter, conversation, options) {
      if (exporter instanceof JSONExporter) {
        const exportData = options.includeMetadata ? conversation : {
          id: conversation.id,
          title: conversation.title,
          messages: conversation.messages,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        };
        return JSON.stringify(exportData, null, 2);
      }
      if (exporter instanceof MarkdownExporter) {
        return this.generateSimpleMarkdown(conversation, options);
      }
      if (exporter instanceof DocxExporter) {
        throw new Error("DOCX format is not fully supported in ZIP export yet (TODO)");
      }
      return JSON.stringify(conversation, null, 2);
    }
    /**
     * 生成简化的 Markdown 内容
     * 
     * 这是 MarkdownExporter 的简化版本，用于 ZIP 导出
     */
    generateSimpleMarkdown(conversation, _options) {
      const lines = [];
      lines.push(`# ${conversation.title || "对话导出"}`);
      lines.push("");
      lines.push(`> Exported at: ${(/* @__PURE__ */ new Date()).toLocaleString("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    })}`);
      lines.push("");
      const roleMap = {
        user: "User",
        assistant: "Assistant",
        system: "System",
        tool: "Tool",
        unknown: "Unknown"
      };
      for (let i = 0; i < conversation.messages.length; i++) {
        const message = conversation.messages[i];
        const roleLabel = roleMap[message.role] || message.role;
        const timestamp = new Date(message.timestamp).toLocaleString("en-US", {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true
        });
        lines.push(`## ${roleLabel} (Turn ${i + 1})`);
        lines.push(`*${timestamp}*`);
        lines.push("");
        lines.push(message.content.text);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      return lines.join("\n");
    }
    /**
     * 生成对话文件名
     * 
     * 格式：序号_标题_日期.扩展名
     * 例如：001_你好_2024-03-19.json
     */
    generateConversationFilename(conversation, extension, index, total) {
      const digits = Math.ceil(Math.log10(total + 1));
      const paddedIndex = String(index + 1).padStart(Math.max(3, digits), "0");
      const title = conversation.title || `conversation-${index + 1}`;
      const safeTitle = title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, "_").replace(/_+/g, "_").substring(0, 50);
      const date = new Date(conversation.updatedAt);
      const dateStr = date.toISOString().split("T")[0];
      return `${paddedIndex}_${safeTitle}_${dateStr}.${extension}`;
    }
    /**
     * 生成 ZIP 文件名
     * 
     * 格式：chat-export-格式-YYYYMMDD-HHMMSS.zip
     */
    generateZipFilename(format, platform) {
      const now = /* @__PURE__ */ new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
      if (format === "bundle") return `${platform || "chat"}-export-${timestamp}.zip`;
      return `chat-export-${format}-${timestamp}.zip`;
    }
  }
  class DirectoryBackupWriter {
    constructor(sessionDirectory, sessionDirectoryName) {
      __publicField(this, "sessionDirectoryName");
      __publicField(this, "sessionDirectory");
      __publicField(this, "markdownExporter", new MarkdownExporter());
      __publicField(this, "records", []);
      __publicField(this, "usedDirectoryNames", /* @__PURE__ */ new Set());
      this.sessionDirectory = sessionDirectory;
      this.sessionDirectoryName = sessionDirectoryName;
    }
    static async create(_platform = "chat") {
      const pickerHost = globalThis;
      if (!pickerHost.showDirectoryPicker) {
        throw new Error("当前浏览器不支持文件夹写入，请使用最新版 Chrome 或 Edge");
      }
      const selectedRoot = await pickerHost.showDirectoryPicker({ mode: "readwrite" });
      return new DirectoryBackupWriter(selectedRoot, selectedRoot.name);
    }
    async writeConversation(rawConversation, conversation, _index, _total, source) {
      const rawData = rawConversation.data !== null && typeof rawConversation.data === "object" ? rawConversation.data : {};
      const listMetadata = rawData._exportListMetadata !== null && typeof rawData._exportListMetadata === "object" ? rawData._exportListMetadata : {};
      const id = DirectoryBackupWriter.safeName(conversation.id || "未知ID");
      const time = DirectoryBackupWriter.safeTime(conversation.updatedAt || conversation.createdAt);
      const groupName = DirectoryBackupWriter.safeName(
        String(listMetadata.projectName || rawData.projectName || rawData.project_name || "其他")
      );
      const baseName = `${id}_${time}_${groupName}`;
      let directoryName = baseName;
      let duplicate = 2;
      while (this.usedDirectoryNames.has(directoryName)) {
        directoryName = `${baseName}_${duplicate}`;
        duplicate += 1;
      }
      this.usedDirectoryNames.add(directoryName);
      const directory = await this.sessionDirectory.getDirectoryHandle(directoryName, { create: true });
      await Promise.all([
        this.writeTextFile(directory, "raw.json", JSON.stringify(rawConversation.data, null, 2)),
        this.writeTextFile(
          directory,
          "conversation.md",
          this.markdownExporter.renderConversation(conversation, {
            format: "markdown",
            includeMetadata: true
          })
        )
      ]);
      this.records.push({
        id: conversation.id,
        title: conversation.title,
        directory: directoryName,
        messageCount: conversation.messages.length,
        source
      });
      return directoryName;
    }
    async finalize(metadata) {
      await this.writeTextFile(this.sessionDirectory, "metadata.json", JSON.stringify({
        ...metadata,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        conversations: this.records
      }, null, 2));
    }
    async writeTextFile(directory, filename, content) {
      const fileHandle = await directory.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }
    static safeTime(timestamp) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return "未知时间";
      const pad = (value, length = 2) => String(value).padStart(length, "0");
      return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }
    static safeName(value) {
      const sanitized = String(value || "export").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").replace(/_+/g, "_").trim();
      return sanitized || "export";
    }
  }
  const exporterRegistry = /* @__PURE__ */ new Map();
  exporterRegistry.set("json", JSONExporter);
  exporterRegistry.set("markdown", MarkdownExporter);
  exporterRegistry.set("docx", DocxExporter);
  exporterRegistry.set("zip", ZIPExporter);
  function getExporter(format) {
    const ExporterClass = exporterRegistry.get(format);
    if (!ExporterClass) {
      console.warn(`[ExporterRegistry] No exporter found for ${format}`);
      return null;
    }
    return new ExporterClass();
  }
  function injectStyles() {
    if (document.getElementById("cet-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "cet-styles";
    style.textContent = STYLES_CSS;
    document.head.appendChild(style);
  }
  const STYLES_CSS = `
/* ============================================================================
   CSS Variables - 主题配置
   ============================================================================ */
:root {
  --cet-primary-color: #007bff;
  --cet-primary-hover: #0056b3;
  --cet-success-color: #28a745;
  --cet-warning-color: #ffc107;
  --cet-danger-color: #dc3545;
  --cet-info-color: #17a2b8;
  
  --cet-bg-color: #ffffff;
  --cet-bg-secondary: #f8f9fa;
  --cet-border-color: #dee2e6;
  --cet-text-color: #212529;
  --cet-text-muted: #6c757d;
  
  --cet-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  --cet-shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.2);
  --cet-border-radius: 8px;
  --cet-border-radius-sm: 4px;
  
  --cet-transition: all 0.3s ease;
  --cet-z-index: 999999;
}

[data-theme="dark"] {
  --cet-bg-color: #1a1a1a;
  --cet-bg-secondary: #2d2d2d;
  --cet-border-color: #404040;
  --cet-text-color: #e0e0e0;
  --cet-text-muted: #a0a0a0;
  --cet-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  --cet-shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.5);
}

/* ============================================================================
   基础样式重置
   ============================================================================ */
.cet-container * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.cet-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--cet-text-color);
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
  z-index: var(--cet-z-index);
}

.cet-container > * {
  pointer-events: auto;
}

/* ============================================================================
   FAB 浮动按钮
   ============================================================================ */
.cet-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--cet-primary-color);
  color: white;
  border: none;
  box-shadow: var(--cet-shadow-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--cet-transition);
  z-index: calc(var(--cet-z-index) + 1);
}

.cet-fab:hover {
  background: var(--cet-primary-hover);
  transform: scale(1.1);
}

.cet-fab:active {
  transform: scale(0.95);
}

.cet-fab-icon {
  width: 24px;
  height: 24px;
  fill: currentColor;
  transition: var(--cet-transition);
}

.cet-fab-expanded .cet-fab-icon {
  transform: rotate(45deg);
}

/* ============================================================================
   导出面板
   ============================================================================ */
.cet-panel {
  position: fixed;
  bottom: 96px;
  right: 24px;
  width: 320px;
  background: var(--cet-bg-color);
  border-radius: var(--cet-border-radius);
  box-shadow: var(--cet-shadow-lg);
  border: 1px solid var(--cet-border-color);
  overflow: hidden;
  transition: var(--cet-transition);
  z-index: calc(var(--cet-z-index) + 1);
}

.cet-panel-hidden {
  transform: translateY(20px);
  opacity: 0;
  pointer-events: none;
}

.cet-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--cet-bg-secondary);
  border-bottom: 1px solid var(--cet-border-color);
}

.cet-panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--cet-text-color);
}

.cet-panel-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--cet-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--cet-transition);
}

.cet-panel-close:hover {
  background: var(--cet-border-color);
  color: var(--cet-text-color);
}

.cet-panel-body {
  padding: 16px;
}

.cet-panel-section {
  margin-bottom: 16px;
}

.cet-panel-section:last-child {
  margin-bottom: 0;
}

.cet-panel-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--cet-text-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cet-panel-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cet-option {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--cet-bg-secondary);
  border-radius: var(--cet-border-radius-sm);
  cursor: pointer;
  transition: var(--cet-transition);
  border: 2px solid transparent;
}

.cet-option:hover {
  background: var(--cet-border-color);
}

.cet-option-selected {
  border-color: var(--cet-primary-color);
  background: rgba(0, 123, 255, 0.1);
}

.cet-option-input {
  width: 18px;
  height: 18px;
  margin-right: 10px;
  cursor: pointer;
}

.cet-option-text {
  flex: 1;
  font-size: 14px;
  color: var(--cet-text-color);
}

.cet-option-desc {
  font-size: 12px;
  color: var(--cet-text-muted);
  margin-top: 2px;
}

.cet-panel-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--cet-border-color);
}

.cet-btn {
  flex: 1;
  padding: 10px 16px;
  border-radius: var(--cet-border-radius-sm);
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: var(--cet-transition);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.cet-btn-primary {
  background: var(--cet-primary-color);
  color: white;
}

.cet-btn-primary:hover {
  background: var(--cet-primary-hover);
}

.cet-btn-secondary {
  background: var(--cet-bg-secondary);
  color: var(--cet-text-color);
  border: 1px solid var(--cet-border-color);
}

.cet-btn-secondary:hover {
  background: var(--cet-border-color);
}

.cet-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ============================================================================
   Toast 通知
   ============================================================================ */
.cet-toast-container {
  position: fixed;
  top: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: calc(var(--cet-z-index) + 2);
  pointer-events: none;
}

.cet-toast {
  min-width: 280px;
  max-width: 400px;
  padding: 14px 16px;
  background: var(--cet-bg-color);
  border-radius: var(--cet-border-radius);
  box-shadow: var(--cet-shadow-lg);
  border-left: 4px solid;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  pointer-events: auto;
  animation: cet-toast-slide-in 0.3s ease;
}

@keyframes cet-toast-slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.cet-toast-hiding {
  animation: cet-toast-slide-out 0.3s ease forwards;
}

@keyframes cet-toast-slide-out {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
}

.cet-toast-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.cet-toast-content {
  flex: 1;
  min-width: 0;
}

.cet-toast-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--cet-text-color);
}

.cet-toast-message {
  font-size: 13px;
  color: var(--cet-text-muted);
  word-wrap: break-word;
}

.cet-toast-close {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--cet-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: var(--cet-transition);
}

.cet-toast-close:hover {
  background: var(--cet-border-color);
  color: var(--cet-text-color);
}

/* Toast 类型 */
.cet-toast-success {
  border-left-color: var(--cet-success-color);
}

.cet-toast-success .cet-toast-icon {
  color: var(--cet-success-color);
}

.cet-toast-error {
  border-left-color: var(--cet-danger-color);
}

.cet-toast-error .cet-toast-icon {
  color: var(--cet-danger-color);
}

.cet-toast-warning {
  border-left-color: var(--cet-warning-color);
}

.cet-toast-warning .cet-toast-icon {
  color: var(--cet-warning-color);
}

.cet-toast-info {
  border-left-color: var(--cet-info-color);
}

.cet-toast-info .cet-toast-icon {
  color: var(--cet-info-color);
}

/* ============================================================================
   进度条
   ============================================================================ */
.cet-progress {
  width: 100%;
}

.cet-progress-bar {
  height: 8px;
  background: var(--cet-bg-secondary);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.cet-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--cet-primary-color), var(--cet-info-color));
  border-radius: 4px;
  transition: width 0.3s ease;
}

.cet-progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--cet-text-muted);
}

.cet-progress-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 12px;
}

.cet-progress-percent {
  font-weight: 600;
  color: var(--cet-text-color);
  min-width: 45px;
  text-align: right;
}

/* ============================================================================
   加载状态
   ============================================================================ */
.cet-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--cet-text-muted);
}

.cet-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--cet-border-color);
  border-top-color: var(--cet-primary-color);
  border-radius: 50%;
  animation: cet-spin 0.8s linear infinite;
  margin-right: 10px;
}

@keyframes cet-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ============================================================================
   响应式适配
   ============================================================================ */
@media (max-width: 768px) {
  .cet-fab {
    bottom: 16px;
    right: 16px;
    width: 48px;
    height: 48px;
  }
  
  .cet-panel {
    bottom: 80px;
    right: 16px;
    left: 16px;
    width: auto;
  }
  
  .cet-toast-container {
    top: 16px;
    right: 16px;
    left: 16px;
  }
  
  .cet-toast {
    min-width: auto;
    max-width: none;
  }
}
`;
  const ICONS = {
    fab: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 5v14M5 12h14"/>
  </svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M20 6L9 17l-5-5"/>
  </svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/>
    <path d="M15 9l-6 6M9 9l6 6"/>
  </svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
    <path d="M12 9v4M12 17h.01"/>
  </svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 16v-4M12 8h.01"/>
  </svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
  </svg>`
  };
  class ChatExportUI {
    constructor(config = {}) {
      __publicField(this, "container", null);
      __publicField(this, "config");
      __publicField(this, "state");
      __publicField(this, "isInitialized", false);
      // DOM 元素引用
      __publicField(this, "fabEl", null);
      __publicField(this, "panelEl", null);
      __publicField(this, "toastContainerEl", null);
      // Toast 管理
      __publicField(this, "toastCounter", 0);
      __publicField(this, "toastTimers", /* @__PURE__ */ new Map());
      this.config = {
        theme: "auto",
        locale: "zh-CN",
        ...config
      };
      this.state = {
        panelVisible: false,
        exportScope: "current",
        exportFormat: "json",
        isExporting: false,
        progress: null
      };
    }
    /**
     * 初始化 UI
     */
    async init() {
      if (this.isInitialized) {
        console.warn("[ChatExportUI] Already initialized");
        return;
      }
      console.log("[ChatExportUI] Initializing...");
      injectStyles();
      if (typeof this.config.container === "string") {
        this.container = document.querySelector(this.config.container);
      } else if (this.config.container instanceof HTMLElement) {
        this.container = this.config.container;
      } else {
        this.container = document.body;
      }
      if (!this.container) {
        throw new Error("[ChatExportUI] Container not found");
      }
      const wrapper = document.createElement("div");
      wrapper.className = "cet-container";
      wrapper.id = "cet-ui-container";
      this.container.appendChild(wrapper);
      this.renderFab(wrapper);
      this.renderPanel(wrapper);
      this.renderToastContainer(wrapper);
      this.applyTheme(this.config.theme || "auto");
      this.bindEvents();
      this.isInitialized = true;
      console.log("[ChatExportUI] Initialized successfully");
    }
    /**
     * 渲染 FAB 按钮
     */
    renderFab(container) {
      const fab = document.createElement("button");
      fab.className = "cet-fab";
      fab.innerHTML = `<span class="cet-fab-icon">${ICONS.fab}</span>`;
      fab.title = "Chat Export Toolkit";
      container.appendChild(fab);
      this.fabEl = fab;
    }
    /**
     * 渲染导出面板
     */
    renderPanel(container) {
      const panel = document.createElement("div");
      panel.className = "cet-panel cet-panel-hidden";
      panel.innerHTML = `
      <div class="cet-panel-header">
        <h3 class="cet-panel-title">导出对话</h3>
        <button class="cet-panel-close" title="关闭">
          ${ICONS.close}
        </button>
      </div>
      <div class="cet-panel-body">
        <div class="cet-panel-section">
          <label class="cet-panel-label">导出范围</label>
          <div class="cet-panel-options">
            <label class="cet-option cet-option-selected" data-option="scope" data-value="current">
              <input type="radio" name="cet-scope" value="current" class="cet-option-input" checked>
              <div class="cet-option-text">
                <div>当前会话</div>
                <div class="cet-option-desc">仅导出当前显示的对话</div>
              </div>
            </label>
            <label class="cet-option" data-option="scope" data-value="all">
              <input type="radio" name="cet-scope" value="all" class="cet-option-input">
              <div class="cet-option-text">
                <div>全部会话</div>
                <div class="cet-option-desc">选择文件夹，逐个写入原始 JSON + Markdown</div>
              </div>
            </label>
          </div>
        </div>
        
        <div class="cet-panel-section">
          <label class="cet-panel-label">导出格式</label>
          <div class="cet-panel-options">
            <label class="cet-option cet-option-selected" data-option="format" data-value="json">
              <input type="radio" name="cet-format" value="json" class="cet-option-input" checked>
              <div class="cet-option-text">
                <div>JSON</div>
                <div class="cet-option-desc">结构化数据，适合程序处理</div>
              </div>
            </label>
            <label class="cet-option" data-option="format" data-value="markdown">
              <input type="radio" name="cet-format" value="markdown" class="cet-option-input">
              <div class="cet-option-text">
                <div>Markdown</div>
                <div class="cet-option-desc">可读性强，适合阅读</div>
              </div>
            </label>
          </div>
        </div>
        
        <div class="cet-panel-actions">
          <button class="cet-btn cet-btn-secondary" data-action="cancel" disabled>
            取消
          </button>
          <button class="cet-btn cet-btn-primary" data-action="export">
            <span class="cet-btn-icon">${ICONS.download}</span>
            导出
          </button>
        </div>
      </div>
    `;
      container.appendChild(panel);
      this.panelEl = panel;
    }
    /**
     * 渲染 Toast 容器
     */
    renderToastContainer(container) {
      const toastContainer = document.createElement("div");
      toastContainer.className = "cet-toast-container";
      container.appendChild(toastContainer);
      this.toastContainerEl = toastContainer;
    }
    /**
     * 绑定事件
     */
    bindEvents() {
      if (!this.fabEl || !this.panelEl) return;
      this.fabEl.addEventListener("click", () => {
        this.togglePanel();
      });
      const closeBtn = this.panelEl.querySelector(".cet-panel-close");
      closeBtn == null ? void 0 : closeBtn.addEventListener("click", () => {
        this.hidePanel();
      });
      const options = this.panelEl.querySelectorAll(".cet-option");
      options.forEach((option) => {
        option.addEventListener("click", (e) => {
          const target = e.currentTarget;
          const optionType = target.dataset.option;
          const value = target.dataset.value;
          if (optionType === "scope") {
            this.state.exportScope = value;
          } else if (optionType === "format") {
            this.state.exportFormat = value;
          }
          const parent = target.parentElement;
          parent == null ? void 0 : parent.querySelectorAll(".cet-option").forEach((opt) => {
            opt.classList.remove("cet-option-selected");
          });
          target.classList.add("cet-option-selected");
          const input = target.querySelector("input");
          input == null ? void 0 : input.click();
        });
      });
      const exportBtn = this.panelEl.querySelector('[data-action="export"]');
      exportBtn == null ? void 0 : exportBtn.addEventListener("click", () => {
        this.handleExport();
      });
      const cancelBtn = this.panelEl.querySelector('[data-action="cancel"]');
      cancelBtn == null ? void 0 : cancelBtn.addEventListener("click", () => {
        this.handleCancel();
      });
    }
    /**
     * 应用主题
     */
    applyTheme(theme) {
      if (!this.container) return;
      if (theme === "auto") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        theme = prefersDark ? "dark" : "light";
      }
      this.container.setAttribute("data-theme", theme);
      console.log(`[ChatExportUI] Applied theme: ${theme}`);
    }
    /**
     * 切换面板显示
     */
    togglePanel() {
      if (this.state.panelVisible) {
        this.hidePanel();
      } else {
        this.showPanel();
      }
    }
    /**
     * 显示面板
     */
    showPanel() {
      var _a;
      if (!this.panelEl) return;
      this.state.panelVisible = true;
      this.panelEl.classList.remove("cet-panel-hidden");
      (_a = this.fabEl) == null ? void 0 : _a.classList.add("cet-fab-expanded");
    }
    /**
     * 隐藏面板
     */
    hidePanel() {
      var _a;
      if (!this.panelEl) return;
      this.state.panelVisible = false;
      this.panelEl.classList.add("cet-panel-hidden");
      (_a = this.fabEl) == null ? void 0 : _a.classList.remove("cet-fab-expanded");
    }
    /**
     * 处理导出
     */
    handleExport() {
      var _a, _b;
      if (this.state.isExporting) return;
      const { exportScope, exportFormat } = this.state;
      console.log("[ChatExportUI] Export started:", {
        scope: exportScope,
        format: exportFormat
      });
      this.state.isExporting = true;
      this.updateExportButton(true);
      (_b = (_a = this.config.callbacks) == null ? void 0 : _a.onExportStart) == null ? void 0 : _b.call(_a, {
        scope: exportScope,
        format: exportFormat
      });
      this.showToast({
        type: "info",
        title: "开始导出",
        message: exportScope === "current" ? "正在导出当前会话..." : "正在导出全部会话...",
        duration: 3e3
      });
    }
    /**
     * 处理取消
     */
    handleCancel() {
      var _a, _b;
      if (!this.state.isExporting) return;
      console.log("[ChatExportUI] Export cancelled");
      this.state.isExporting = false;
      this.updateExportButton(false);
      this.updateProgress(null);
      (_b = (_a = this.config.callbacks) == null ? void 0 : _a.onExportError) == null ? void 0 : _b.call(_a, new Error("User cancelled"));
      this.showToast({
        type: "warning",
        title: "已取消",
        message: "导出已取消",
        duration: 2e3
      });
    }
    /**
     * 更新导出按钮状态
     */
    updateExportButton(isExporting) {
      if (!this.panelEl) return;
      const exportBtn = this.panelEl.querySelector('[data-action="export"]');
      const cancelBtn = this.panelEl.querySelector('[data-action="cancel"]');
      if (exportBtn) {
        exportBtn.disabled = isExporting;
        exportBtn.innerHTML = isExporting ? '<span class="cet-spinner" style="width:16px;height:16px;border-width:2px;"></span> 导出中...' : `<span class="cet-btn-icon">${ICONS.download}</span> 导出`;
      }
      if (cancelBtn) {
        cancelBtn.disabled = !isExporting;
      }
    }
    /**
     * 显示 Toast
     */
    showToast(options) {
      if (!this.toastContainerEl) {
        console.warn("[ChatExportUI] Toast container not ready");
        return -1;
      }
      const toastId = ++this.toastCounter;
      const { type, title, message, duration = 3e3 } = options;
      const toast = document.createElement("div");
      toast.className = `cet-toast cet-toast-${type}`;
      toast.dataset.toastId = String(toastId);
      toast.innerHTML = `
      <div class="cet-toast-icon">
        ${this.getToastIcon(type)}
      </div>
      <div class="cet-toast-content">
        <div class="cet-toast-title">${this.escapeHtml(title)}</div>
        <div class="cet-toast-message">${this.escapeHtml(message)}</div>
      </div>
      <button class="cet-toast-close">${ICONS.close}</button>
    `;
      const closeBtn = toast.querySelector(".cet-toast-close");
      closeBtn == null ? void 0 : closeBtn.addEventListener("click", () => {
        this.hideToast(toastId);
      });
      this.toastContainerEl.appendChild(toast);
      if (duration > 0) {
        const timer = setTimeout(() => {
          this.hideToast(toastId);
        }, duration);
        this.toastTimers.set(toastId, timer);
      }
      return toastId;
    }
    /**
     * 隐藏 Toast
     */
    hideToast(toastId) {
      var _a;
      const toast = (_a = this.toastContainerEl) == null ? void 0 : _a.querySelector(`[data-toast-id="${toastId}"]`);
      if (!toast) return;
      const timer = this.toastTimers.get(toastId);
      if (timer) {
        clearTimeout(timer);
        this.toastTimers.delete(toastId);
      }
      toast.classList.add("cet-toast-hiding");
      setTimeout(() => {
        toast.remove();
      }, 300);
    }
    /**
     * 获取 Toast 图标
     */
    getToastIcon(type) {
      switch (type) {
        case "success":
          return ICONS.check;
        case "error":
          return ICONS.error;
        case "warning":
          return ICONS.warning;
        case "info":
        default:
          return ICONS.info;
      }
    }
    /**
     * 更新进度
     */
    updateProgress(progress) {
      var _a, _b, _c, _d;
      this.state.progress = progress;
      if (!progress) {
        const existingProgress = (_a = this.panelEl) == null ? void 0 : _a.querySelector(".cet-progress");
        existingProgress == null ? void 0 : existingProgress.remove();
        return;
      }
      if (!this.panelEl) return;
      let progressEl = this.panelEl.querySelector(".cet-progress");
      if (!progressEl) {
        progressEl = document.createElement("div");
        progressEl.className = "cet-progress";
        progressEl.innerHTML = `
        <div class="cet-progress-bar">
          <div class="cet-progress-fill"></div>
        </div>
        <div class="cet-progress-info">
          <span class="cet-progress-text"></span>
          <span class="cet-progress-percent">0%</span>
        </div>
      `;
        const actionsEl = this.panelEl.querySelector(".cet-panel-actions");
        (_b = actionsEl == null ? void 0 : actionsEl.parentNode) == null ? void 0 : _b.insertBefore(progressEl, actionsEl);
      }
      const percent = Math.round(progress.current / progress.total * 100);
      const fillEl = progressEl.querySelector(".cet-progress-fill");
      const textEl = progressEl.querySelector(".cet-progress-text");
      const percentEl = progressEl.querySelector(".cet-progress-percent");
      if (fillEl) fillEl.style.width = `${percent}%`;
      if (textEl) textEl.textContent = progress.message || `处理中 ${progress.current}/${progress.total}`;
      if (percentEl) percentEl.textContent = `${percent}%`;
      (_d = (_c = this.config.callbacks) == null ? void 0 : _c.onExportProgress) == null ? void 0 : _d.call(_c, percent, progress.message || "");
    }
    /**
     * 导出完成
     */
    exportComplete(result) {
      var _a, _b;
      this.state.isExporting = false;
      this.updateExportButton(false);
      this.updateProgress(null);
      (_b = (_a = this.config.callbacks) == null ? void 0 : _a.onExportComplete) == null ? void 0 : _b.call(_a, result);
      this.showToast({
        type: "success",
        title: "导出完成",
        message: result.outputPath ? `已完成：${result.outputPath}` : "导出文件已写入您的设备",
        duration: 3e3
      });
    }
    /**
     * 导出失败
     */
    exportError(error) {
      var _a, _b;
      this.state.isExporting = false;
      this.updateExportButton(false);
      this.updateProgress(null);
      (_b = (_a = this.config.callbacks) == null ? void 0 : _a.onExportError) == null ? void 0 : _b.call(_a, error);
      this.showToast({
        type: "error",
        title: "导出失败",
        message: error.message,
        duration: 5e3
      });
    }
    /**
     * 获取当前状态
     */
    getState() {
      return { ...this.state };
    }
    /**
     * 更新状态
     */
    setState(state) {
      this.state = { ...this.state, ...state };
      if (state.panelVisible !== void 0) {
        if (state.panelVisible) {
          this.showPanel();
        } else {
          this.hidePanel();
        }
      }
    }
    /**
     * 销毁 UI
     */
    destroy() {
      console.log("[ChatExportUI] Destroying...");
      this.toastTimers.forEach((timer) => clearTimeout(timer));
      this.toastTimers.clear();
      if (this.container) {
        const wrapper = this.container.querySelector("#cet-ui-container");
        wrapper == null ? void 0 : wrapper.remove();
      }
      this.isInitialized = false;
    }
    /**
     * HTML 转义
     */
    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }
  }
  function createUI(config) {
    return new ChatExportUI(config);
  }
  function log(message, data, debug = false) {
    if (debug || !debug) {
      if (data !== void 0) {
        console.log(`[Interceptor] ${message}`, data);
      } else {
        console.log(`[Interceptor] ${message}`);
      }
    }
  }
  function logError(message, error) {
    console.error(`[Interceptor] ${message}`, error || "");
  }
  function urlMatchesPattern(url, pattern) {
    if (pattern instanceof RegExp) {
      return pattern.test(url);
    }
    return url.includes(pattern);
  }
  function extractConversationData(response) {
    if (!response || typeof response !== "object") {
      return null;
    }
    const obj = response;
    if (obj.id && (obj.messages || obj.conversation)) {
      return {
        platform: "custom",
        data: response
      };
    }
    if (obj.data && typeof obj.data === "object") {
      const data = obj.data;
      if (data.id || data.messages) {
        return {
          platform: "custom",
          data: response
        };
      }
    }
    if (obj.conversation && typeof obj.conversation === "object") {
      return {
        platform: "custom",
        data: response
      };
    }
    if (obj.result && typeof obj.result === "object") {
      const result = obj.result;
      if (result.id || result.messages) {
        return {
          platform: "custom",
          data: response
        };
      }
    }
    if (Array.isArray(obj)) {
      return {
        platform: "custom",
        data: response
      };
    }
    const commonFields = ["conversation_id", "chat_id", "thread_id", "messages", "history"];
    for (const field of commonFields) {
      if (field in obj) {
        return {
          platform: "custom",
          data: response
        };
      }
    }
    return null;
  }
  function extractMessagesData(response) {
    if (!response || typeof response !== "object") {
      return [];
    }
    const obj = response;
    const messages = [];
    if (Array.isArray(obj.messages)) {
      for (const msg of obj.messages) {
        messages.push({
          platform: "custom",
          data: msg
        });
      }
      return messages;
    }
    if (obj.data && typeof obj.data === "object") {
      const data = obj.data;
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          messages.push({
            platform: "custom",
            data: msg
          });
        }
        return messages;
      }
    }
    if (Array.isArray(obj)) {
      for (const msg of obj) {
        messages.push({
          platform: "custom",
          data: msg
        });
      }
      return messages;
    }
    if (obj.result && typeof obj.result === "object") {
      const result = obj.result;
      if (Array.isArray(result.messages)) {
        for (const msg of result.messages) {
          messages.push({
            platform: "custom",
            data: msg
          });
        }
        return messages;
      }
    }
    return messages;
  }
  class XHRInterceptor {
    constructor(config, store = null, onCapture) {
      __publicField(this, "originalOpen");
      __publicField(this, "originalSend");
      __publicField(this, "config");
      __publicField(this, "store");
      __publicField(this, "onCapture");
      this.config = config;
      this.store = store;
      this.onCapture = onCapture;
      this.originalOpen = XMLHttpRequest.prototype.open;
      this.originalSend = XMLHttpRequest.prototype.send;
    }
    /**
     * 启动拦截
     */
    start() {
      if (typeof XMLHttpRequest === "undefined") {
        logError("XHR not available in this environment");
        return;
      }
      log("Starting XHR interceptor", this.config, this.config.debug);
      const self = this;
      XMLHttpRequest.prototype.open = function(method, url, async, username, password) {
        this._interceptedMethod = method;
        this._interceptedUrl = url;
        this._interceptedTimestamp = Date.now();
        self.originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
      };
      XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;
        const url = xhr._interceptedUrl;
        const method = xhr._interceptedMethod;
        const timestamp = xhr._interceptedTimestamp;
        const shouldIntercept = self.shouldInterceptUrl(url);
        if (shouldIntercept) {
          log(`XHR request intercepted: ${method} ${url}`, void 0, self.config.debug);
          let parsedBody;
          if (body && typeof body === "string") {
            try {
              parsedBody = JSON.parse(body);
            } catch {
              parsedBody = body;
            }
          }
          const headers = {};
          const originalOnReadyStateChange = xhr.onreadystatechange;
          xhr.onreadystatechange = function() {
            if (originalOnReadyStateChange) {
              originalOnReadyStateChange.call(this);
            }
            if (xhr.readyState === 4) {
              const response = self.parseResponse(xhr);
              const interceptedRequest = {
                url,
                method,
                headers,
                body: parsedBody,
                response,
                timestamp
              };
              if (self.onCapture) {
                self.onCapture(interceptedRequest);
              }
              if (self.store && response) {
                self.storeCapture(interceptedRequest);
              }
            }
          };
        }
        self.originalSend.call(xhr, body);
      };
      log("XHR interceptor started");
    }
    /**
     * 停止拦截
     */
    stop() {
      XMLHttpRequest.prototype.open = this.originalOpen;
      XMLHttpRequest.prototype.send = this.originalSend;
      log("XHR interceptor stopped");
    }
    /**
     * 解析 XHR 响应
     */
    parseResponse(xhr) {
      try {
        const contentType = xhr.getResponseHeader("Content-Type") || "";
        const responseText = xhr.responseText;
        if (!responseText) {
          return null;
        }
        if (contentType.includes("application/json")) {
          try {
            return JSON.parse(responseText);
          } catch {
            return responseText;
          }
        }
        try {
          return JSON.parse(responseText);
        } catch {
          return responseText;
        }
      } catch (error) {
        logError("Failed to parse XHR response", error);
        return null;
      }
    }
    /**
     * 检查 URL 是否应该被拦截
     */
    shouldInterceptUrl(url) {
      const patterns = this.config.endpointPatterns;
      if (!patterns || patterns.length === 0) {
        return true;
      }
      for (const pattern of patterns) {
        if (urlMatchesPattern(url, pattern)) {
          return true;
        }
      }
      return false;
    }
    /**
     * 存储捕获的数据
     */
    async storeCapture(request) {
      if (!this.store) return;
      try {
        const conversationData = extractConversationData(request.response);
        if (conversationData) {
          const key = `cache:conversation:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await this.store.set(key, conversationData);
          log(`Stored conversation: ${key}`, void 0, this.config.debug);
        }
        const messagesData = extractMessagesData(request.response);
        if (messagesData.length > 0) {
          const key = `cache:messages:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await this.store.set(key, messagesData);
          log(`Stored ${messagesData.length} messages: ${key}`, void 0, this.config.debug);
        }
      } catch (error) {
        logError("Failed to store captured data", error);
      }
    }
  }
  class FetchInterceptor {
    constructor(config, store = null, onCapture) {
      __publicField(this, "originalFetch");
      __publicField(this, "originalWindowFetch");
      __publicField(this, "config");
      __publicField(this, "store");
      __publicField(this, "onCapture");
      this.config = config;
      this.store = store;
      this.onCapture = onCapture;
      this.originalWindowFetch = window.fetch;
      this.originalFetch = window.fetch.bind(window);
    }
    /**
     * 启动拦截
     */
    start() {
      if (typeof fetch === "undefined") {
        logError("Fetch not available in this environment");
        return;
      }
      log("Starting Fetch interceptor", this.config, this.config.debug);
      window.fetch = this.interceptFetch.bind(this);
      log("Fetch interceptor started");
    }
    /**
     * 停止拦截
     */
    stop() {
      window.fetch = this.originalWindowFetch;
      log("Fetch interceptor stopped");
    }
    /**
     * 拦截 fetch 请求
     */
    async interceptFetch(input, init) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init == null ? void 0 : init.method) || "GET";
      const timestamp = Date.now();
      const shouldIntercept = this.shouldInterceptUrl(url);
      if (!shouldIntercept) {
        return this.originalFetch(input, init);
      }
      log(`Fetch request intercepted: ${method} ${url}`, void 0, this.config.debug);
      let parsedBody;
      if (init == null ? void 0 : init.body) {
        if (typeof init.body === "string") {
          try {
            parsedBody = JSON.parse(init.body);
          } catch {
            parsedBody = init.body;
          }
        } else if (init.body instanceof FormData) {
          parsedBody = Object.fromEntries(init.body.entries());
        }
      }
      const headers = {};
      if (init == null ? void 0 : init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headers[key] = value;
          }
        } else {
          Object.assign(headers, init.headers);
        }
      }
      try {
        const response = await this.originalFetch(input, init);
        const clonedResponse = response.clone();
        this.processResponse(clonedResponse, {
          url,
          method,
          headers,
          body: parsedBody,
          timestamp
        });
        return response;
      } catch (error) {
        logError("Fetch request failed", error);
        throw error;
      }
    }
    /**
     * 处理响应
     */
    async processResponse(response, request) {
      try {
        const contentType = response.headers.get("Content-Type") || "";
        let responseData;
        if (contentType.includes("application/json")) {
          responseData = await response.json();
        } else {
          const text = await response.text();
          try {
            responseData = JSON.parse(text);
          } catch {
            responseData = text;
          }
        }
        const interceptedRequest = {
          ...request,
          response: responseData
        };
        if (this.onCapture) {
          this.onCapture(interceptedRequest);
        }
        if (this.store && responseData) {
          await this.storeCapture(interceptedRequest);
        }
      } catch (error) {
        logError("Failed to process fetch response", error);
      }
    }
    /**
     * 检查 URL 是否应该被拦截
     */
    shouldInterceptUrl(url) {
      const patterns = this.config.endpointPatterns;
      if (!patterns || patterns.length === 0) {
        return true;
      }
      for (const pattern of patterns) {
        if (urlMatchesPattern(url, pattern)) {
          return true;
        }
      }
      return false;
    }
    /**
     * 存储捕获的数据
     */
    async storeCapture(request) {
      if (!this.store) return;
      try {
        const conversationData = extractConversationData(request.response);
        if (conversationData) {
          const key = `cache:conversation:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await this.store.set(key, conversationData);
          log(`Stored conversation: ${key}`, void 0, this.config.debug);
        }
        const messagesData = extractMessagesData(request.response);
        if (messagesData.length > 0) {
          const key = `cache:messages:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await this.store.set(key, messagesData);
          log(`Stored ${messagesData.length} messages: ${key}`, void 0, this.config.debug);
        }
      } catch (error) {
        logError("Failed to store captured data", error);
      }
    }
  }
  class ApiEndpointDiscoverer {
    constructor(config) {
      __publicField(this, "endpoints", /* @__PURE__ */ new Map());
      __publicField(this, "config");
      this.config = config;
    }
    /**
     * 记录请求
     */
    recordRequest(url, response) {
      var _a;
      const existing = this.endpoints.get(url);
      if (existing) {
        existing.lastAccessed = Date.now();
        existing.accessCount++;
      } else {
        const type = this.classifyEndpoint(url, response);
        this.endpoints.set(url, {
          url,
          type,
          lastAccessed: Date.now(),
          accessCount: 1
        });
      }
      log(`Endpoint recorded: ${url} (${(_a = this.endpoints.get(url)) == null ? void 0 : _a.type})`, void 0, this.config.debug);
    }
    /**
     * 分类端点类型
     */
    classifyEndpoint(url, response) {
      const urlLower = url.toLowerCase();
      if (urlLower.includes("/conversations") || urlLower.includes("/chat/list")) {
        return "list";
      }
      if (urlLower.includes("/conversation/") || urlLower.includes("/chat/")) {
        return "conversation";
      }
      if (urlLower.includes("/messages") || urlLower.includes("/message/")) {
        return "message";
      }
      if (response) {
        const obj = response;
        if (Array.isArray(obj)) {
          return "list";
        }
        if (obj.messages || obj.conversation) {
          return "conversation";
        }
      }
      return "unknown";
    }
    /**
     * 获取所有发现的端点
     */
    getEndpoints() {
      return Array.from(this.endpoints.values());
    }
    /**
     * 获取端点匹配模式
     */
    getPatterns() {
      return Array.from(this.endpoints.keys());
    }
    /**
     * 清除旧端点
     */
    clearOldEndpoints(maxAge = 36e5) {
      const now = Date.now();
      for (const [url, endpoint] of this.endpoints.entries()) {
        if (now - endpoint.lastAccessed > maxAge) {
          this.endpoints.delete(url);
        }
      }
    }
    /**
     * 导出端点配置
     */
    exportConfig() {
      return {
        ...this.config,
        endpointPatterns: this.getPatterns()
      };
    }
  }
  class InterceptorStateManager {
    constructor() {
      __publicField(this, "state");
      this.state = {
        isRunning: false,
        capturedCount: 0,
        conversationCount: 0,
        endpoints: /* @__PURE__ */ new Map()
      };
    }
    /**
     * 更新状态
     */
    update(updates) {
      Object.assign(this.state, updates);
    }
    /**
     * 记录捕获
     */
    recordCapture(isConversation) {
      this.state.capturedCount++;
      if (isConversation) {
        this.state.conversationCount++;
      }
      this.state.lastCapturedAt = Date.now();
    }
    /**
     * 获取状态
     */
    getState() {
      return { ...this.state };
    }
    /**
     * 重置状态
     */
    reset() {
      this.state = {
        isRunning: false,
        capturedCount: 0,
        conversationCount: 0,
        endpoints: /* @__PURE__ */ new Map()
      };
    }
  }
  class RequestInterceptor {
    constructor(config, store = null) {
      __publicField(this, "config");
      __publicField(this, "store");
      __publicField(this, "xhrInterceptor", null);
      __publicField(this, "fetchInterceptor", null);
      __publicField(this, "discoverer");
      __publicField(this, "stateManager");
      __publicField(this, "onCaptureCallbacks", []);
      this.config = {
        platform: config.platform,
        endpointPatterns: config.endpointPatterns || [],
        enableXHR: config.enableXHR ?? true,
        enableFetch: config.enableFetch ?? true,
        timeout: config.timeout || 3e4,
        debug: config.debug ?? false
      };
      this.store = store;
      this.discoverer = new ApiEndpointDiscoverer(this.config);
      this.stateManager = new InterceptorStateManager();
    }
    /**
     * 启动拦截
     */
    start() {
      if (this.stateManager.getState().isRunning) {
        log("Interceptor already running");
        return;
      }
      log("Starting Request Interceptor", this.config, this.config.debug);
      const onCapture = this.handleCapture.bind(this);
      if (this.config.enableXHR && typeof XMLHttpRequest !== "undefined") {
        this.xhrInterceptor = new XHRInterceptor(this.config, this.store, onCapture);
        this.xhrInterceptor.start();
      }
      if (this.config.enableFetch && typeof fetch !== "undefined") {
        this.fetchInterceptor = new FetchInterceptor(this.config, this.store, onCapture);
        this.fetchInterceptor.start();
      }
      this.stateManager.update({ isRunning: true });
      log("Request Interceptor started successfully");
    }
    /**
     * 停止拦截
     */
    stop() {
      log("Stopping Request Interceptor");
      if (this.xhrInterceptor) {
        this.xhrInterceptor.stop();
        this.xhrInterceptor = null;
      }
      if (this.fetchInterceptor) {
        this.fetchInterceptor.stop();
        this.fetchInterceptor = null;
      }
      this.stateManager.update({ isRunning: false });
      log("Request Interceptor stopped");
    }
    /**
     * 处理捕获的请求
     */
    handleCapture(request) {
      this.stateManager.recordCapture(false);
      this.discoverer.recordRequest(request.url, request.response);
      const conversationData = extractConversationData(request.response);
      if (conversationData) {
        this.stateManager.recordCapture(true);
        log(`Captured conversation data from ${request.url}`, void 0, this.config.debug);
      }
      const messagesData = extractMessagesData(request.response);
      if (messagesData.length > 0) {
        log(`Captured ${messagesData.length} messages from ${request.url}`, void 0, this.config.debug);
      }
      for (const callback of this.onCaptureCallbacks) {
        try {
          callback(request);
        } catch (error) {
          logError("Error in capture callback", error);
        }
      }
    }
    /**
     * 注册捕获回调
     */
    onCapture(callback) {
      this.onCaptureCallbacks.push(callback);
    }
    /**
     * 移除捕获回调
     */
    offCapture(callback) {
      const index = this.onCaptureCallbacks.indexOf(callback);
      if (index > -1) {
        this.onCaptureCallbacks.splice(index, 1);
      }
    }
    /**
     * 获取拦截器状态
     */
    getState() {
      const state = this.stateManager.getState();
      state.endpoints = this.discoverer.getEndpoints().reduce((map, ep) => {
        map.set(ep.url, ep);
        return map;
      }, /* @__PURE__ */ new Map());
      return state;
    }
    /**
     * 获取发现的 API 端点
     */
    getDiscoveredEndpoints() {
      return this.discoverer.getEndpoints();
    }
    /**
     * 获取端点匹配模式
     */
    getEndpointPatterns() {
      return this.discoverer.getPatterns();
    }
    /**
     * 清除旧端点
     */
    clearOldEndpoints(maxAge) {
      this.discoverer.clearOldEndpoints(maxAge);
    }
    /**
     * 导出配置
     */
    exportConfig() {
      return this.discoverer.exportConfig();
    }
    /**
     * 重置状态
     */
    reset() {
      this.stateManager.reset();
      this.discoverer = new ApiEndpointDiscoverer(this.config);
    }
  }
  function createInterceptor(config, store) {
    const interceptor = new RequestInterceptor(config, store);
    interceptor.start();
    return interceptor;
  }
  /**
   * Chat Export Toolkit V2
   * 统一的消息导出工具包
   * 
   * @version 2.0.0-alpha
   * @author Chat Export Toolkit Team
   * @license MIT
   */
  const _ChatExportToolkit = class _ChatExportToolkit {
    constructor() {
      __publicField(this, "runtime", null);
      __publicField(this, "store", null);
      __publicField(this, "adapter", null);
      __publicField(this, "normalizer", null);
      __publicField(this, "exporter", null);
      __publicField(this, "ui", null);
      __publicField(this, "interceptor", null);
      __publicField(this, "isInitialized", false);
      __publicField(this, "currentPlatform", null);
    }
    /**
     * 初始化 Toolkit
     */
    async init(config) {
      var _a;
      if (this.isInitialized) {
        console.warn("[ChatExportToolkit] Already initialized");
        return;
      }
      console.log("╔════════════════════════════════════════════════════════╗");
      console.log("║     Chat Export Toolkit V2                            ║");
      console.log("║     Version:", _ChatExportToolkit.VERSION.padEnd(34), "║");
      console.log("╚════════════════════════════════════════════════════════╝");
      console.log("[Toolkit] Initializing...");
      try {
        this.runtime = createRuntimeBridge(config == null ? void 0 : config.runtime);
        await this.runtime.init();
        console.log("[Toolkit] Runtime bridge initialized");
        this.store = createStore();
        console.log("[Toolkit] Store initialized");
        if ((config == null ? void 0 : config.autoDetect) !== false) {
          this.currentPlatform = detectPlatform();
          if (this.currentPlatform) {
            console.log(`[Toolkit] Auto-detected platform: ${this.currentPlatform}`);
          }
        }
        if (!this.currentPlatform && (config == null ? void 0 : config.platform)) {
          this.currentPlatform = config.platform;
        }
        if (this.currentPlatform) {
          this.adapter = getAdapter(this.currentPlatform);
          if (this.adapter) {
            console.log(`[Toolkit] Platform adapter initialized: ${this.currentPlatform}`);
            this.normalizer = getNormalizer(this.currentPlatform);
            if (this.normalizer) {
              console.log(`[Toolkit] Normalizer initialized: ${this.currentPlatform}`);
            }
          } else {
            console.warn(`[Toolkit] No adapter found for platform: ${this.currentPlatform}`);
          }
        }
        this.exporter = getExporter("json");
        if (this.exporter) {
          console.log("[Toolkit] Default exporter initialized: json");
        }
        if (this.currentPlatform === "yuanbao") {
          this.interceptor = createInterceptor({
            platform: "yuanbao",
            enableXHR: true,
            enableFetch: true,
            debug: true
          }, this.store);
          console.log("[Toolkit] API interceptor installed");
        }
        const userCallbacks = (_a = config == null ? void 0 : config.ui) == null ? void 0 : _a.callbacks;
        this.ui = createUI({
          ...config == null ? void 0 : config.ui,
          callbacks: {
            ...userCallbacks,
            onExportStart: (options) => {
              var _a2;
              (_a2 = userCallbacks == null ? void 0 : userCallbacks.onExportStart) == null ? void 0 : _a2.call(userCallbacks, options);
              void this.handleExportStart(options);
            }
          }
        });
        await this.ui.init();
        console.log("[Toolkit] UI initialized");
        this.isInitialized = true;
        console.log("[Toolkit] ✅ Initialization complete");
        console.log("[Toolkit] Environment:", this.runtime.capabilities.environment);
        console.log("[Toolkit] DOM Access:", this.runtime.capabilities.canAccessDOM);
        console.log("[Toolkit] Network:", this.runtime.capabilities.canMakeNetworkRequests);
        console.log("[Toolkit] Storage:", this.runtime.capabilities.canStoreData);
      } catch (error) {
        console.error("[Toolkit] Initialization failed:", error);
        throw error;
      }
    }
    /**
     * 处理导出开始
     */
    async handleExportStart(options) {
      console.log("[Toolkit] Export started:", options);
      try {
        let result;
        if (options.scope === "current") {
          result = await this.exportCurrentConversation(options.format);
        } else {
          result = await this.exportAllConversations("directory");
        }
        if (result.success) {
          this.handleExportComplete(result);
        } else {
          this.handleExportError(new Error(result.error || "Export failed"));
        }
      } catch (error) {
        this.handleExportError(error instanceof Error ? error : new Error(String(error)));
      }
    }
    /**
     * 处理导出完成
     */
    handleExportComplete(result) {
      var _a;
      console.log("[Toolkit] Export complete:", result);
      (_a = this.ui) == null ? void 0 : _a.exportComplete(result);
    }
    /**
     * 处理导出错误
     */
    handleExportError(error) {
      var _a;
      console.error("[Toolkit] Export error:", error);
      (_a = this.ui) == null ? void 0 : _a.exportError(error);
    }
    /**
     * 导出当前对话（最小可运行链路）
     */
    async exportCurrentConversation(format = "json") {
      var _a, _b;
      if (!this.isInitialized) {
        throw new Error("[Toolkit] Not initialized. Call init() first.");
      }
      console.log("[Toolkit] Exporting current conversation...");
      try {
        if (!this.adapter || !this.normalizer) {
          return {
            success: false,
            error: "Platform adapter or normalizer is unavailable",
            stats: { messageCount: 0, conversationCount: 0 }
          };
        }
        const rawConversation = await this.adapter.getConversation(void 0, { forceRefresh: true });
        if (!rawConversation) {
          const metadata = await ((_b = (_a = this.adapter).getMetadata) == null ? void 0 : _b.call(_a));
          const detail = typeof (metadata == null ? void 0 : metadata.lastRequestError) === "string" ? `: ${metadata.lastRequestError}` : "";
          return {
            success: false,
            error: `Failed to fetch the current conversation${detail}`,
            stats: { messageCount: 0, conversationCount: 0 },
            details: metadata
          };
        }
        const conversation = await this.normalizer.normalizeConversation(rawConversation);
        const exporter = format ? getExporter(format) : this.exporter;
        if (!exporter) {
          return {
            success: false,
            error: `No exporter found for format: ${format}`,
            stats: { messageCount: 0, conversationCount: 0 }
          };
        }
        const result = await exporter.exportConversation(conversation, {
          format,
          includeMetadata: true
        });
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stats: { messageCount: 0, conversationCount: 0 }
        };
      }
    }
    /**
     * 导出所有对话（默认直接写入用户选择的文件夹）
     * 
     * @param format 导出格式，支持 'directory', 'json', 'markdown', 'zip'
     * @returns 导出结果
     */
    async exportAllConversations(format = "directory", options = {}) {
      if (!this.isInitialized) {
        throw new Error("[Toolkit] Not initialized. Call init() first.");
      }
      console.log("[Toolkit] Exporting all conversations...");
      try {
        if (!this.adapter || !this.store || !this.normalizer) {
          return {
            success: false,
            error: "Platform adapter, store, or normalizer is unavailable",
            stats: { messageCount: 0, conversationCount: 0 }
          };
        }
        if (format === "directory") {
          return await this.exportAllToDirectory(options);
        }
        const collection = await collectAllConversations(this.adapter, this.store, options);
        if (collection.rawConversations.length === 0) {
          return {
            success: false,
            error: collection.failures.length > 0 ? `No conversations could be downloaded (${collection.failures.length} failed)` : "No conversations were returned by the server",
            stats: { messageCount: 0, conversationCount: 0 },
            details: { ...collection, rawConversations: void 0 }
          };
        }
        const conversations = [];
        const normalizationFailures = [];
        for (const rawConv of collection.rawConversations) {
          try {
            const normalized = await this.normalizer.normalizeConversation(rawConv);
            conversations.push(normalized);
          } catch (error) {
            normalizationFailures.push({
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        if (conversations.length === 0) {
          return {
            success: false,
            error: "No conversations to export",
            stats: { messageCount: 0, conversationCount: 0 }
          };
        }
        console.log(`[Toolkit] Prepared ${conversations.length}/${collection.listedCount} conversations`);
        const details = {
          listedCount: collection.listedCount,
          exportedCount: conversations.length,
          downloadedCount: collection.downloadedCount,
          cacheHitCount: collection.cacheHitCount,
          refreshedCount: collection.refreshedCount,
          failureCount: collection.failures.length,
          failures: collection.failures,
          normalizationFailures,
          forceFullExport: options.forceFullExport === true
        };
        if (format === "zip") {
          const exporter = getExporter("zip");
          if (!exporter) {
            return {
              success: false,
              error: "ZIP exporter not found",
              stats: { messageCount: 0, conversationCount: 0 }
            };
          }
          const result = await exporter.exportAll(conversations, {
            format: "json",
            includeMetadata: true,
            bundleBothFormats: true,
            rawConversations: collection.rawConversations,
            exportWarnings: [
              ...collection.failures.map((failure) => ({ ...failure })),
              ...normalizationFailures
            ],
            platformName: this.currentPlatform || void 0
          });
          return { ...result, details };
        } else {
          const exporter = getExporter(format);
          if (!exporter) {
            return {
              success: false,
              error: `No exporter found for format: ${format}`,
              stats: { messageCount: 0, conversationCount: 0 }
            };
          }
          const result = await exporter.exportAll(conversations, {
            format,
            includeMetadata: true
          });
          return { ...result, details };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stats: { messageCount: 0, conversationCount: 0 }
        };
      }
    }
    async exportAllToDirectory(options) {
      var _a, _b, _c, _d, _e;
      if (!this.adapter || !this.store || !this.normalizer) {
        return {
          success: false,
          error: "Platform adapter, store, or normalizer is unavailable",
          stats: { messageCount: 0, conversationCount: 0 }
        };
      }
      (_a = this.ui) == null ? void 0 : _a.updateProgress({ current: 0, total: 1, message: "请选择保存文件夹…" });
      const writer = await DirectoryBackupWriter.create(this.currentPlatform || "chat");
      (_b = this.ui) == null ? void 0 : _b.updateProgress({ current: 0, total: 1, message: "正在获取服务器会话列表…" });
      let exportedCount = 0;
      let messageCount = 0;
      const normalizationFailures = [];
      const collection = await collectAllConversations(this.adapter, this.store, {
        ...options,
        retainRawConversations: false,
        onConversation: async (rawConversation, progress) => {
          var _a2, _b2;
          (_a2 = this.ui) == null ? void 0 : _a2.updateProgress({
            current: Math.max(0, progress.completed - 1),
            total: progress.total,
            message: `正在写入 ${progress.completed}/${progress.total}：${progress.conversationId}`
          });
          try {
            const conversation = await this.normalizer.normalizeConversation(rawConversation);
            await writer.writeConversation(
              rawConversation,
              conversation,
              progress.completed,
              progress.total,
              progress.source
            );
            exportedCount++;
            messageCount += conversation.messages.length;
          } catch (error) {
            normalizationFailures.push({
              conversationId: progress.conversationId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          await ((_b2 = options.onConversation) == null ? void 0 : _b2.call(options, rawConversation, progress));
        },
        onProgress: (completed, total, conversationId) => {
          var _a2, _b2;
          (_a2 = this.ui) == null ? void 0 : _a2.updateProgress({
            current: completed,
            total,
            message: `已完成 ${completed}/${total}：${conversationId}`
          });
          (_b2 = options.onProgress) == null ? void 0 : _b2.call(options, completed, total, conversationId);
        }
      });
      (_c = this.ui) == null ? void 0 : _c.updateProgress({
        current: collection.listedCount,
        total: Math.max(1, collection.listedCount),
        message: "正在写入导出清单…"
      });
      await writer.finalize({
        platform: this.currentPlatform,
        listedCount: collection.listedCount,
        exportedCount,
        downloadedCount: collection.downloadedCount,
        cacheHitCount: collection.cacheHitCount,
        refreshedCount: collection.refreshedCount,
        failures: collection.failures,
        normalizationFailures,
        forceFullExport: options.forceFullExport === true,
        adapterMetadata: await ((_e = (_d = this.adapter).getMetadata) == null ? void 0 : _e.call(_d))
      });
      return {
        success: exportedCount > 0,
        outputPath: writer.sessionDirectoryName,
        error: exportedCount === 0 ? collection.listedCount === 0 ? "The Yuanbao server returned no conversations; no DOM fallback was exported" : "No conversations could be written" : void 0,
        stats: { messageCount, conversationCount: exportedCount },
        details: {
          listedCount: collection.listedCount,
          exportedCount,
          downloadedCount: collection.downloadedCount,
          cacheHitCount: collection.cacheHitCount,
          failureCount: collection.failures.length,
          failures: collection.failures,
          normalizationFailures
        }
      };
    }
    /**
     * 设置平台适配器
     */
    setPlatform(platform) {
      this.adapter = getAdapter(platform);
      if (!this.adapter) {
        throw new Error(`No adapter found for platform: ${platform}`);
      }
      this.normalizer = getNormalizer(platform);
      this.currentPlatform = platform;
      console.log(`[Toolkit] Platform set to: ${platform}`);
    }
    /**
     * 检测当前平台
     */
    detectPlatform() {
      return detectPlatform();
    }
    /**
     * 获取存储实例
     */
    getStore() {
      return this.store;
    }
    /**
     * 获取运行时实例
     */
    getRuntime() {
      return this.runtime;
    }
    /**
     * 检查是否已初始化
     */
    checkInitialized() {
      return this.isInitialized;
    }
    /**
     * 销毁 Toolkit
     */
    destroy() {
      console.log("[Toolkit] Destroying...");
      if (this.interceptor) {
        this.interceptor.stop();
        this.interceptor = null;
      }
      if (this.runtime) {
        this.runtime.dispose();
        this.runtime = null;
      }
      if (this.ui) {
        this.ui.destroy();
        this.ui = null;
      }
      this.store = null;
      this.adapter = null;
      this.normalizer = null;
      this.exporter = null;
      this.isInitialized = false;
      console.log("[Toolkit] Destroyed");
    }
  };
  /**
   * 版本号
   */
  __publicField(_ChatExportToolkit, "VERSION", "2.0.0-alpha");
  let ChatExportToolkit = _ChatExportToolkit;
  let toolkitInstance = null;
  function getToolkit() {
    if (!toolkitInstance) {
      toolkitInstance = new ChatExportToolkit();
    }
    return toolkitInstance;
  }
  async function initToolkit(config) {
    const toolkit = getToolkit();
    await toolkit.init(config);
    return toolkit;
  }
  if (typeof window !== "undefined") {
    console.log("[Toolkit] Running in browser environment");
    window.ChatExportToolkit = ChatExportToolkit;
    window.getToolkit = getToolkit;
    window.initToolkit = initToolkit;
    const autoInitialize = () => {
      if (!detectPlatform()) return;
      void initToolkit().catch((error) => {
        console.error("[Toolkit] Automatic initialization failed:", error);
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoInitialize, { once: true });
    } else {
      autoInitialize();
    }
  }

})();