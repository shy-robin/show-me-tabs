import { Bucket } from "./types/tab";

class TabManager {
  private currentWindowId = -1;
  private maxTabsCount = 7;
  // Map 无法使用 JSON.stringify 做序列化，所以用 object 代替
  private bucket: Bucket = {};

  constructor() {
    this.init();
  }

  async init() {
    await this.initData();
    this.organizeTabs();
    this.initListener();
  }

  async initData() {
    const { bucket = {} } = await chrome.storage.local.get(["bucket"]);
    this.bucket = bucket;
  }

  /**
   * 整理标签页
   */
  async organizeTabs() {
    const currentWindow = await chrome.windows.getCurrent();
    this.currentWindowId = currentWindow.id ?? -1;
    this.updateBucket(this.currentWindowId);

    const { ungroupedTabs } = await this.getTabsInfo();
    const ungroupedTabsCount = ungroupedTabs.length;

    if (ungroupedTabsCount === 0) {
      return;
    }
    // 如果标签页数量超过阈值
    if (ungroupedTabsCount > this.maxTabsCount) {
      this.groupExcessTabs(ungroupedTabs);
      return;
    }
    // 如果标签页数量低于阈值
    if (ungroupedTabsCount < this.maxTabsCount) {
      this.fillMissingTabs();
    }
  }

  async updateBucket(windowId: number) {
    if (windowId < 0 || this.bucket[windowId]) {
      return;
    }
    this.bucket[windowId] = {
      groupId: undefined,
      lastPinnedIndex: -1,
      tabInfoMap: {},
    };
    this.saveBucket();
  }

  async initListener() {
    // 创建标签页时触发
    chrome.tabs.onCreated.addListener(() => {
      this.organizeTabs();
    });
    // 在标签页关闭时触发。
    chrome.tabs.onRemoved.addListener(() => {
      this.organizeTabs();
    });
    // 在窗口中的活动标签页发生变化时触发。
    chrome.tabs.onActivated.addListener(() => {
      this.handleActivateGroupedTabs();
    });
    // 在标签页更新时触发。
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      // 如果标签页固定或者取消固定，则重新整理标签页
      if ("pinned" in changeInfo) {
        this.organizeTabs();
      }
    });
    chrome.windows.onFocusChanged.addListener((windowId) => {
      this.currentWindowId = windowId;
    });
    chrome.tabGroups.onRemoved.addListener((tabGroup) => {
      const { id } = tabGroup;
      const windowInfo = this.bucket[this.currentWindowId];
      if (windowInfo && id === windowInfo.groupId) {
        windowInfo.groupId = undefined;
        this.saveBucket();
      }
    });
    // 监听 popup 消息
    chrome.runtime.onMessage.addListener(
      async (request, _sender, sendResponse) => {
        (async () => {
          const updateGroupInfo = async (params: {
            title?: string;
            color?: string;
          }) => {
            const { title, color } = params;
            const windowInfo = this.bucket[this.currentWindowId];
            if (!windowInfo || !windowInfo.groupId) {
              return false;
            }
            await chrome.tabGroups.update(windowInfo.groupId, {
              collapsed: true,
              color: color as any,
              title,
            });
          };
          try {
            const { event, val } = request;
            switch (event) {
              case "update:maxTabsCount":
                this.maxTabsCount = val;
                await this.organizeTabs();
                break;
              case "update:rule":
                break;
              case "update:groupLabel":
                const res = updateGroupInfo({ title: val });
                if (!res) {
                  return sendResponse(false);
                }
                break;
              case "update:groupColor":
                const res2 = updateGroupInfo({ color: val });
                if (!res2) {
                  return sendResponse(false);
                }
                break;
              default:
                return sendResponse(false);
            }
            sendResponse(true);
          } catch (err) {
            console.error(err);
            sendResponse(false);
          }
        })();

        return true;
      }
    );
  }

  async getTabsInfo() {
    const windowInfo = this.bucket[this.currentWindowId];
    const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
    const tabInfoMap = windowInfo?.tabInfoMap;
    let pinnedIndex = -1;
    // 更新标签的上一次访问时间
    currentWindowTabs.forEach((tab) => {
      const { id, lastAccessed, pinned } = tab;
      if (pinned) {
        pinnedIndex++;
      }
      if (id && lastAccessed) {
        const info = tabInfoMap?.[id] ?? {};
        if (tabInfoMap) {
          tabInfoMap[id] = {
            ...info,
            lastAccessed,
          };
        }
      }
    });
    windowInfo && (windowInfo.lastPinnedIndex = pinnedIndex);
    const ungroupedTabs = currentWindowTabs.filter(
      (tab) => tab.groupId < 0 && !tab.pinned
    );
    this.saveBucket();

    return {
      currentWindowTabs,
      ungroupedTabs,
    };
  }

  /**
   * 将超过阈值的标签页收纳到分组里
   */
  async groupExcessTabs(ungroupedTabs: chrome.tabs.Tab[]) {
    const windowInfo = this.bucket[this.currentWindowId];
    if (!windowInfo) {
      return;
    }
    const tabInfoMap = windowInfo.tabInfoMap;
    // NOTE: 当标签页移动后，lastAccessed 会变为 undefined
    const originalTabs = ungroupedTabs.slice().map((tab) => ({
      ...tab,
      lastAccessed:
        tab.lastAccessed || tabInfoMap[tab.id ?? -1]?.lastAccessed || 0,
    }));
    console.log(
      "before",
      originalTabs.map((item) => ({
        title: item.title,
        lastAccessed: item.lastAccessed,
      }))
    );
    // 需要移入分组的标签页 id
    const tabIds = originalTabs
      .sort((a, b) => a.lastAccessed - b.lastAccessed)
      .slice(0, ungroupedTabs.length - this.maxTabsCount)
      .map((tab) => tab.id ?? -1);
    console.log(
      "after",
      originalTabs
        .sort((a, b) => a.lastAccessed - b.lastAccessed)
        .map((item) => ({
          title: item.title,
          lastAccessed: item.lastAccessed,
        }))
    );
    // 创建分组
    this.groupTab(tabIds, windowInfo.groupId);
  }

  /**
   * 将低于阈值的标签页从分组里取出填充
   */
  async fillMissingTabs() {
    const groupId = this.bucket[this.currentWindowId]?.groupId;
    if (!groupId) {
      return;
    }
    const groupedTabs = await chrome.tabs.query({
      groupId,
    });
    const lastTabInGroup = groupedTabs[groupedTabs.length - 1];
    if (!lastTabInGroup) {
      return;
    }
    if (lastTabInGroup.id) {
      await this.ungroupTab(groupedTabs, lastTabInGroup.id);
    }
  }

  /**
   * 移入或创建分组
   */
  async groupTab(tabIds: number | number[], groupId?: number) {
    const windowInfo = this.bucket[this.currentWindowId];
    if (!windowInfo) {
      return;
    }
    // 创建分组
    const newGroupId = await chrome.tabs.group({
      groupId,
      tabIds,
    });
    windowInfo.groupId = newGroupId;
    // 将分组移到首位
    await chrome.tabGroups.move(newGroupId, {
      index: windowInfo.lastPinnedIndex + 1,
    });
    // 更新分组的状态
    await chrome.tabGroups.update(newGroupId, {
      collapsed: true,
      color: "blue",
      title: "MORE",
    });
    this.saveBucket();
  }

  /**
   * 移出或销毁分组
   */
  async ungroupTab(groupedTabs: chrome.tabs.Tab[], tabId: number | number[]) {
    const windowInfo = this.bucket[this.currentWindowId];
    if (!windowInfo) {
      return;
    }
    const onlyOneTab = groupedTabs.length === 1;
    await chrome.tabs.ungroup(tabId);
    if (onlyOneTab) {
      windowInfo.groupId = undefined;
    }
    if (windowInfo.groupId) {
      await chrome.tabGroups.move(windowInfo.groupId, {
        index: windowInfo.lastPinnedIndex + 1,
      });
    }
    this.saveBucket();
  }

  /**
   * 处理用户切换到分组标签页
   */
  async handleActivateGroupedTabs() {
    const windowInfo = this.bucket[this.currentWindowId];
    if (!windowInfo) {
      return;
    }
    const { currentWindowTabs, ungroupedTabs } = await this.getTabsInfo();
    const currentActiveTab = currentWindowTabs.find((tab) => tab.active);
    if (!currentActiveTab || !currentActiveTab.id) {
      return;
    }
    const isGroupedTab = currentActiveTab.groupId === windowInfo.groupId;
    if (!isGroupedTab) {
      return;
    }
    // FIXME: why
    await new Promise((resolve) => {
      setTimeout(() => resolve(true), 100);
    });
    // 找到未分组标签页中最早访问的标签
    const groupedTabs = currentWindowTabs.filter(
      (tab) => tab.groupId === windowInfo.groupId
    );
    const tabInfoMap = this.bucket[this.currentWindowId]?.tabInfoMap;
    const originalTabs = ungroupedTabs.slice().map((tab) => ({
      ...tab,
      lastAccessed:
        tab.lastAccessed || tabInfoMap?.[tab.id ?? -1]?.lastAccessed || 0,
    }));
    const [firstAccessedTab] = originalTabs;
    // 将选中标签页移出分组
    await this.ungroupTab(groupedTabs, currentActiveTab.id);
    // 将最早访问的标签移入分组
    firstAccessedTab.id &&
      this.groupTab(firstAccessedTab.id, windowInfo.groupId);
  }

  saveBucket() {
    chrome.storage.local.set({
      bucket: this.bucket,
    });
  }
}

new TabManager();
