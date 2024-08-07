# show-me-tabs

## TODO

- [x] 按照时间顺序保留标签页
- [ ] 自动删除重复的 tabs
  - 留作扩展功能，放到最后，参考其他项目
- [ ] 收缩其他自定义组
  - 留作配置项
- [ ] 配置项
  - 最大个数
  - 整理规则（访问先后，点击次数）
  - 分组信息（文案、颜色）
  - 收缩其他组
- [ ] 清理缓存数据

## BUG

- [x] 如果有置顶标签：Error: Cannot move the group to an index that is in the middle of pinned tabs.
- [x] 新窗口添加标签页，会影响旧窗口标签页的分组
  - 原因：多个窗口共用了同一个 groupId
  - 解决方案：使用 Map 映射多个窗口，每个窗口中存放对应的 groupId
- [x] Map 类型无法序列化，因此无法存储到 storage 中
  - 原因：storage 无法存储非序列化的数据: `JSON.stringify(new Map.set('test', '111'))`
  - 解决方案：使用 object 代替 Map
- [x] 长时间不使用浏览器会重新分组
  - 原因：浏览器自身策略，长时间不使用会将 background 销毁，激活浏览器后重新执行 background
  - 解决方案：将用到的变量存储到 storage 中，初始化时读取 storage 的数据
- [ ] 单词存储数据超出显示：Error: QUOTA_BYTES_PER_ITEM quota exceeded
  - 如果单个数据项大小超过 8192 字节,会抛出 QUOTA_BYTES_PER_ITEM 错误。
  - 如果总存储空间超过 100KB,会抛出 QUOTA_BYTES 错误。
  - 如何检测长度：https://stackoverflow.com/questions/67552133/chrome-api-runtime-quota-bytes-per-item-quota-exceeded-error-but-precheck-pass
  - 解决方案：
    1. 扁平化存储结构，减少单次存储量
    2. 写入大数据时采取分包，读取时将包组合(https://stackoverflow.com/questions/67353979/algorithm-to-break-down-item-for-chrome-storage-sync/67429150)
    3. 定期清理数据
    4. 使用 local

## Flow

- 现有两个逻辑

  - 标签页自动隐藏（当普通标签页数量超过阈值时触发）

  - 标签页自动展示（当普通标签页数量低于阈值时触发）

  - 标签页自动置换（当用户点击了 MORE 分组的标签页时触发）

- 对应交互场景

  - 何时触发标签页自动隐藏？

    1. 新建标签页
    2. ~~将标签页移出分组或取消分组~~
    3. ~~将其他窗口标签页移入当前窗口~~

    为什么无法实现？

    - 会改变用户行为，让交互变得难以理解
    - 这些行为的 case 较多，容易产生未知的问题
    - api 不兼容，会引发 `Tabs cannot be edited right now (user may be dragging a tab).` 问题，这是主要原因 🤣

  - 何时触发标签页自动展示？

    1. 关闭标签页
    2. ~~将标签页移入分组或新建分组~~
    3. ~~将当前窗口标签页移出当前窗口~~

  - 何时触发标签页自动置换？

    1. 用户点击了 MORE 分组的标签页

- 具体逻辑

  - 标签页自动隐藏

    - 如果不存在分组 MORE，则新建 MORE 分组并将多余标签页移到分组中

    - 如果存在分组 MORE，则将多余标签页移到分组中

      - 如果用户已经创建分组怎么办？

        自动保留用户分组，不操作原有用户分组。

    - 如何定义普通标签页

      - 没有分组 id 并且不是置顶标签（`tab.groupId < 0 && !tab.pinned`）

    - 如何定义多余标签页？

      - 按照标签页的索引排序，最左侧的视为多余标签页（废弃）
      - 按照用户使用时间排序
      - 按照用户点击次数排序
      - 按照标签页的上次访问时间排序，将离上次访问时间最久的视为多余标签页

  - 标签页自动展示

    - 如果不存在分组 MORE，则不执行操作

    - 如果存在分组 MORE，则从分组中取出空闲标签页展示

    - 如何定义空闲标签页？

      - 按照标签页在分组中的索引，最右侧的视为空闲标签页

  - 标签页自动置换

    - 如果不存在普通标签页，则不执行操作

    - 如果存在普通标签页，则从中取出离上一次访问时间最久的标签页进行置换
