---
date: 2026-02-01
article: true
star: false
sticky: false
category:
  - 技术日志
tag:
  - Minecraft
  - KubeJS
  - Forge
  - NeoForge
---

# KubeJS 模组脚本开发基础指南

![](https://kubejs.com/favicon.svg)
<!-- more -->
---

这是一份面向“想用脚本给整合包/服务器加功能”的入门指南，重点覆盖 KubeJS 的概念、目录结构、脚本类型、常用写法与常见坑点。

## 0. 前置技能（建议）

1. JavaScript（偏 ES5）
- 变量与作用域、对象/数组、函数、闭包
- JSON 读写与基本调试思路（日志、逐步缩小范围）

2. Minecraft 基础概念
- 指令、记分板（scoreboard）、实体/方块、维度
- 数据包（data pack）与资源包（resource pack）的基本概念（不要求会写，但要知道它们在干嘛）

3. 模组加载器与版本意识
- Forge / Fabric / NeoForge 的区别
- “同一个模组”会按 MC 版本、加载器拆成不同文件/分支

4. VS Code 基础使用
- 安装 VS Code，并用“打开文件夹”方式打开 `.minecraft` 目录
- 需要补全时配合 ProbeJS 生成类型声明（见第 3 节）

## 1. KubeJS 是什么？能做什么？

官网：<https://kubejs.com/>

KubeJS 是一个“用 JavaScript 写脚本来扩展游戏逻辑/数据内容”的模组。定位并非编写新的 Java 模组（.jar），而是用脚本完成：

- 改配方、改战利品、改标签（本质是数据包层面的内容）
- 监听事件做逻辑（服务端事件、客户端渲染事件等）
- 注册指令，做活动系统、任务系统联动、计分板奖励等
- 配合其它 KubeJS addon（例如配方系统扩展、UI/任务联动等）实现更多玩法

### 1.1 关键前置模组

常见的“前置依赖关系”可按下述方式理解：

- Rhino：给 KubeJS 提供 JavaScript 运行时（脚本引擎）
  - 示例版本：Rhino `2001.2.3-build-10`
- Architectury API：跨加载器/通用层依赖（很多跨端模组会用）
  - 示例版本：Architectury API `9.2.14`

### 1.2 版本与加载器关系（Forge / NeoForge）

核心结论（用来避免选错文件）：

- Minecraft `1.20.1` 及以前：Forge 生态非常完整，很多模组都有 Forge 版。
- 从 `1.20.2+` 往后：Forge 与 NeoForge 分家，很多模组开始把重心转向 NeoForge。
- KubeJS 的 Forge 分支在 `1.20.1` 常见上限示例：`2001.6.5-build 16`。
- Minecraft `1.21`：通常需要 NeoForge 才能加载对应的新版本（Forge 生态在 1.21 不作为主线）。

- 选择模组时：先确定 MC 版本 → 加载器 → 再选择对应模组文件。

## 2. kubejs 文件夹结构

KubeJS 在游戏首次运行后会生成 `kubejs/` 目录，按“脚本类型 / 资源与数据 / 开发辅助”拆分组织。

### 2.1 目录树（ASCII）

下面是一份典型的 `kubejs/` 目录结构（不同整合包可能略有差异）：

```
kubejs/
├─ startup_scripts/            # 启动阶段脚本（配置/注册等）
├─ server_scripts/             # 服务端脚本（事件/指令/逻辑）
├─ client_scripts/             # 客户端脚本（HUD/渲染/本地交互）
├─ data/                       # 数据包内容（配方/战利品/标签等）
├─ assets/                     # 资源包内容（贴图/模型/语言等）
├─ config/                     # KubeJS 及相关模组配置
├─ probe/                      # ProbeJS：补全与类型提示生成物
├─ jsconfig.json               # IDE/TypeScript 语言服务配置
└─ README.txt                  # KubeJS 自带说明入口
```

### 2.2 各目录用途

- `startup_scripts/`
  - 作用：启动阶段执行。适合做“全局配置入口”“注册类内容”（不同版本可重载能力不同）。

- `server_scripts/`
  - 作用：服务端逻辑与事件监听。适合做活动系统、计分板、持久化、指令注册、实体事件等。

- `client_scripts/`
  - 作用：客户端本地渲染与交互。适合做 HUD、界面绘制、客户端事件响应。
  - 约束：不作为“权威逻辑”，重要数据以服务端为准。

- `data/`
  - 作用：数据包内容。常见包括配方（recipes）、战利品（loot_tables）、标签（tags）等。

- `assets/`
  - 作用：资源包内容。常见包括贴图（textures）、模型（models）、语言文件（lang）等。

- `config/`
  - 作用：模组配置文件目录。一般由模组自动生成或由整合包维护。

- `probe/`
  - 作用：ProbeJS 的输出目录（用于 IDE 补全与类型提示），详见第 3 节。

- `jsconfig.json`
  - 作用：让 VS Code/TypeScript 语言服务正确识别脚本工程与类型声明。

- `README.txt`
  - 作用：KubeJS 的说明文件，包含基础指引与提示。

## 3. ProbeJS：让 VS Code 具备补全与类型提示

ProbeJS 是一个专门为 KubeJS 脚本服务的辅助模组：它会扫描整合包中的方块/物品/事件等信息，生成 VS Code 可识别的类型声明，从而在编写脚本时提供自动补全、参数提示与跳转能力。

参考说明：<https://www.mcmod.cn/class/6486.html>

### 3.1 典型工作流

1. 安装 VS Code。
2. 安装 ProbeJS 模组（以及需要时的 IconExporter）。
3. 启动 Minecraft 进入世界后执行：
   - `/probejs dump`（生成补全所需文件）
4. 使用 VS Code 打开 `.minecraft` 文件夹。
5. 若补全未刷新：在 VS Code 按 `F1`，执行 “TypeScript: Restart TS server”。
6. 若需要显示图标（部分版本/插件组合需要）：执行 `/iconexporter export` 后重启 VS Code。

### 3.2 生成文件在哪里

ProbeJS 的输出通常位于 `kubejs/probe/` ，其中包含缓存与 `generated/*.d.ts` 类型声明文件。

## 4. 基础代码示例：删除一个合成配方（server_scripts）

下面是一个最经典、也最适合入门的示例：删除指定输出物品的合成配方。

示例来源：[remove_recipes.js](https://github.com/246859/kubejs_example/blob/main/server_scripts/remove_recipes.js#L1-L15)

```js
ServerEvents.recipes(event => {
  event.remove({ output: 'create:andesite_alloy' })
  event.remove({ output: 'create:super_glue' })
  event.remove({ output: 'twilightforest:uncrafting_table' })
})
```

理解要点：

- `ServerEvents.recipes`：配方加载阶段的回调
- `event.remove({ output: 'mod:item' })`：按输出物品移除配方

## 5. 进阶代码示例：全服僵尸活动（server + client + startup）

一个更接近“插件开发”的案例是“全服活动系统”，它通常会同时涉及：

- 事件监听（击杀事件、玩家登录事件）
- 自定义指令注册（start/stop/end/status/top/list/me）
- 数据存储与加载（跨重启保持状态与榜单）
- 执行游戏内命令（say、tellraw、scoreboard、title 等）
- 全局配置入口（startup_scripts 提供开关与参数）
- 客户端渲染（HUD 与排行榜）
- 客户端/服务端通信（服务端推送数据到客户端渲染）

参考实现（本整合包）：

- 配置入口：[zombie_activity_config.js](https://github.com/246859/kubejs_example/blob/main/startup_scripts/zombie_activity_config.js)
- 服务端逻辑：[zombie_activity.js](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js)
- 客户端渲染：[zombie_activity_client.js](https://github.com/246859/kubejs_example/blob/main/client_scripts/zombie_activity_client.js)

拆解要点（便于复用为其它活动/插件）：

1. 配置层（startup_scripts）
- `global.xxxConfig` 作为唯一配置入口
- 启动时读配置；活动开始时把关键配置写入 state（例如 targetKills）保证“本次活动一致性”

2. 服务端层（server_scripts）
- 通过 `server.persistentData` 持久化活动状态与榜单数据
- 通过 `ServerEvents.commandRegistry` 注册指令，统一入口做权限与来源区分（玩家/命令方块）
- 通过 `ServerEvents.tick` 做节流同步，把 HUD/榜单数据推送给客户端

3. 客户端层（client_scripts）
- 通过 `NetworkEvents.dataReceived` 接收服务端推送的 JSON 数据
- 通过 `ClientEvents.paintScreen` 进行纯渲染：HUD 文本 + 右侧 TopN 列表

### 5.1 配置入口（startup_scripts）：global 配置与参数约定

配置文件示例：[zombie_activity_config.js](https://github.com/246859/kubejs_example/blob/main/startup_scripts/zombie_activity_config.js#L1-L17)

```js
global.zombieActivityConfig = {
  enabled: true,
  totalTargetKills: 10,
  topN: 5,
  rewardObjective: 'jifen',
  rewardByRank: { 1: 1000, 2: 800, 3: 500 }
}
```

要点：

- `enabled`：总开关，用于控制脚本是否注册事件/指令
- `totalTargetKills`：活动目标（会在每次 start 时写入 state，避免活动中途修改配置导致本次活动目标漂移）
- `topN`：榜单展示数量，影响客户端 TopN 与 `/zombie_activity top`
- `rewardObjective/rewardByRank`：结算时用于 `scoreboard players add` 的目标与分值映射

### 5.2 服务端主入口：总开关与运行态 state

服务端脚本：[zombie_activity.js](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L4-L46)

```js
if (!zombieActivityConfig.enabled) {
  return
}

const state = {
  running: false,
  totalKills: 0,
  targetKills: Number(zombieActivityConfig.totalTargetKills) || DefaultTarget,
  playerKills: {},
  playersSeen: {},
  completed: false,
  rewarded: false
}
```

要点：

- “enabled=false 时直接 return” 可以保证不会注册任何事件/指令，避免无用开销与误触发
- `state` 是活动运行态，属于高内聚的核心数据结构：统计、榜单、结算、同步都围绕它展开

### 5.3 数据持久化：server.persistentData（跨重启保留）

核心函数：[saveToPersistentData](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L178-L217)、[loadFromPersistentData](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L219-L256)

```js
const root = server.persistentData.getCompound(PERSIST_ROOT_KEY)
root.putInt('totalKills', state.totalKills)
root.putInt('targetKills', state.targetKills)
root.putBoolean('rewarded', state.rewarded)
```

要点：

- `server.persistentData` 属于世界存档级别持久化，适合存活动状态与榜单数据
- `targetKills` 同样持久化，保证服务器重启后“本次活动目标值”保持一致

### 5.4 事件监听：击杀统计与登录建档

击杀事件入口：[EntityEvents.death](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L602-L606)

```js
EntityEvents.death('minecraft:zombie', event => {
  ZombieActivity.onZombieDeath(event)
})
```

登录事件入口：[PlayerEvents.loggedIn](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L597-L600)

```js
PlayerEvents.loggedIn(event => {
  ZombieActivity.onPlayerLoggedIn(event)
})
```

要点：

- 统计逻辑集中在 `ZombieActivity.onZombieDeath`，事件层只负责把事件“转交”
- 登录时 `ensurePlayerRecord` 会建档，保证“活动期间登录过但未击杀”的玩家也能在榜单中显示为 0

### 5.5 自定义指令：commandRegistry 注册 start/stop/end/status/top/list/me

指令注册入口：[commandRegistry](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L611-L716)

```js
Commands.literal('zombie_activity')
  .then(Commands.literal('start').requires(src => src.hasPermission(2)))
  .then(Commands.literal('stop').requires(src => src.hasPermission(2)))
  .then(Commands.literal('end').requires(src => src.hasPermission(2)))
```

要点：

- `requires(src => src.hasPermission(2))` 控制 OP 权限
- `start/stop/end` 分离职责：stop 只关闭；end 会结算发奖；达成目标也会触发结算

### 5.6 执行游戏内命令：say / tellraw / title / scoreboard

统一封装示例：[tellPlayer](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L58-L66)

```js
player.runCommandSilent(`tellraw @s ${JSON.stringify({ text: String(message) })}`)
server.runCommandSilent('say ' + String(message))
```

发奖示例：[awardTopN](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L287-L303)

```js
server.runCommandSilent(`scoreboard players add ${w.name} ${objective} ${w.reward}`)
```

要点：

- KubeJS 中很多“效果”最终落到游戏指令，封装可以减少重复与耦合
- `tellraw` 用于私聊输出（例如 status/top/list），`say` 用于公屏广播（例如结算播报）

### 5.7 客户端/服务端通信：sendData + NetworkEvents.dataReceived

服务端推送入口：[sendClientSyncToPlayer](https://github.com/246859/kubejs_example/blob/main/server_scripts/zombie_activity.js#L135-L147)

```js
player.sendData(CLIENT_SYNC_CHANNEL, { json: JSON.stringify(payload) })
```

客户端接收入口：[dataReceived](https://github.com/246859/kubejs_example/blob/main/client_scripts/zombie_activity_client.js#L60-L69)

```js
NetworkEvents.dataReceived(CHANNEL, function (event) {
  let json = event.data.getString('json')
  lastPayload = JSON.parse(String(json))
})
```

要点：

- 服务端是“权威数据源”：统计、榜单、结算都在服务端
- 客户端只负责“显示”，避免出现客户端与服务端数据不一致

### 5.8 客户端渲染：paintScreen 绘制 HUD 与 TopN

渲染入口：[paintScreen](https://github.com/246859/kubejs_example/blob/main/client_scripts/zombie_activity_client.js#L71-L79)

```js
ClientEvents.paintScreen(function (event) {
  if (event.inventory) return
  if (!lastPayload) return
  if (!lastPayload.running) return
  paintHUD(event, lastPayload)
  paintTopN(event, lastPayload)
})
```

要点：

- 通过 `event.inventory` 过滤背包界面，减少遮挡
- HUD 与 TopN 分函数绘制，提高可维护性与可读性

---

## 6. 常见坑（实战经验）


1. 客户端只渲染，不要当服务器用
- 客户端数据可能不完整、可被修改；排行榜/奖励等必须以服务端为准。

2. 版本/加载器不匹配
- 先确认 MC 版本 → 加载器 → 再选 KubeJS/Rhino/Architectury 对应文件。

---
本指南可继续扩展“ProbeJS 查事件/类型的速查法”“脚本项目结构与日志规范”“常用事件与配方写法速查”等章节，以便在整合包协作维护时更易复用与交接。
