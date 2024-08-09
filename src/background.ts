import { Bucket } from "./types/tab";
import {
  DEFAULT_MAX_TABS_COUNT,
  DEFAULT_RULE,
  DEFAULT_GROUP_LABEL,
  DEFAULT_GROUP_COLOR,
} from "./constants";

class TabManager {
  private currentWindowId = -1;
  // Map 无法使用 JSON.stringify 做序列化，所以用 object 代替
  private bucket: Bucket = {};
  private maxTabsCount = DEFAULT_MAX_TABS_COUNT;
  private rule = DEFAULT_RULE;
  private groupLabel = DEFAULT_GROUP_LABEL;
  private groupColor = DEFAULT_GROUP_COLOR;

  constructor() {
    this.init();
  }

  async init() {
    await this.initData();
    await this.organizeTabs();
    await this.initListener();
  }

  async initData() {
    // 大数据存储在 local 中
    const { bucket = {} } = await chrome.storage.local.get(["bucket"]);
    // 配置数据存储在 sync 中
    const {
      maxTabsCount = DEFAULT_MAX_TABS_COUNT,
      rule = DEFAULT_RULE,
      groupLabel = DEFAULT_GROUP_LABEL,
      groupColor = DEFAULT_GROUP_COLOR,
    } = await chrome.storage.sync.get([
      "maxTabsCount",
      "rule",
      "groupLabel",
      "groupColor",
    ]);

    this.bucket = bucket;
    this.maxTabsCount = maxTabsCount;
    this.rule = rule;
    this.groupLabel = groupLabel;
    this.groupColor = groupColor;
  }

  /**
   * 整理标签页
   */
  async organizeTabs(currentWindowId?: number) {
    if (currentWindowId) {
      this.currentWindowId = currentWindowId;
    } else {
      const currentWindow = await chrome.windows.getCurrent();
      this.currentWindowId = currentWindow.id ?? -1;
    }
    this.updateBucket(this.currentWindowId);

    const { ungroupedTabs, currentWindowTabs } = await this.getTabsInfo();
    const ungroupedTabsCount = ungroupedTabs.length;

    if (ungroupedTabsCount === 0) {
      return;
    }
    this.updateBadge(currentWindowTabs.length, this.maxTabsCount);
    // 如果标签页数量超过阈值
    if (ungroupedTabsCount > this.maxTabsCount) {
      await this.groupExcessTabs(ungroupedTabs);
      return;
    }
    // 如果标签页数量低于阈值
    if (ungroupedTabsCount < this.maxTabsCount) {
      await this.fillMissingTabs();
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

  async updateBadge(count: number, maxCount: number) {
    chrome.action.setBadgeText({
      text: String(count),
    });
    chrome.action.setBadgeTextColor({
      color: "#fff",
    });
    chrome.action.setBadgeBackgroundColor({
      color: count <= maxCount ? "#0c0" : "#c00",
    });
  }

  async initListener() {
    // 创建标签页时触发
    chrome.tabs.onCreated.addListener(() => {
      this.organizeTabs();
    });
    // 在标签页关闭时触发。
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.organizeTabs();
      delete this.bucket?.[this.currentWindowId]?.tabInfoMap?.[tabId];
      this.saveBucket();
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
    // 在移除（关闭）窗口时触发。
    chrome.windows.onRemoved.addListener((windowId) => {
      delete this.bucket[windowId];
      this.saveBucket();
    });
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      this.currentWindowId = windowId;
      // 更新角标
      if (windowId < 0) {
        return;
      }
      const { currentWindowTabs } = await this.getTabsInfo();
      this.updateBadge(currentWindowTabs.length, this.maxTabsCount);
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
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      (async () => {
        const updateGroupInfo = async () => {
          const windowInfo = this.bucket[this.currentWindowId];
          try {
            windowInfo?.groupId &&
              (await chrome.tabGroups.update(windowInfo.groupId, {
                collapsed: true,
                color: this.groupColor as any,
                title: this.groupLabel,
              }));
            return true;
          } catch (err) {
            return true;
          }
        };

        let status: boolean;
        try {
          const { event, val, windowId } = request;
          switch (event) {
            case "update:maxTabsCount":
              // NOTE: 当打开 popup 向 background 发送消息时，通过 chrome.windows.getCurrent() 获取
              // 到的当前窗口不是标签页的窗口，而是执行 background 代码的窗口。
              // 具体参考：https://developer.chrome.com/docs/extensions/reference/api/windows?hl=zh-cn#the_current_window
              this.maxTabsCount = val;
              chrome.storage.sync.set({ maxTabsCount: val });
              await this.organizeTabs(windowId);
              status = true;
              break;
            case "update:rule":
              this.rule = val;
              chrome.storage.sync.set({ rule: val });
              status = true;
              break;
            case "update:groupLabel":
              this.groupLabel = val;
              chrome.storage.sync.set({ groupLabel: val });
              status = await updateGroupInfo();
              break;
            case "update:groupColor":
              this.groupColor = val;
              chrome.storage.sync.set({ groupColor: val });
              status = await updateGroupInfo();
              break;
            default:
              status = false;
          }
        } catch (err) {
          console.error(err);
          status = false;
        }

        sendResponse(status);
      })();

      return true;
    });
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
    await this.groupTab(tabIds, windowInfo.groupId);
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
      color: this.groupColor as any,
      title: this.groupLabel,
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
