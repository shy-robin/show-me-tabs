export type Bucket = Record<string, WindowInfo | undefined>;

export interface WindowInfo {
  groupId: number | undefined;
  lastPinnedIndex: number;
  tabInfoMap: Record<string, TabInfo | undefined>;
}

export interface TabInfo {
  lastAccessed: number;
}
