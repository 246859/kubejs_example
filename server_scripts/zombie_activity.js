;(() => {
// 默认目标击杀数：配置缺失/非法时兜底
const DefaultTarget = 3000;
// 全服僵尸活动：服务端逻辑（内存统计版）
const zombieActivityConfig = global.zombieActivityConfig || {
    enabled: true,
    totalTargetKills: 10,
    topN: 5,
    rewardObjective: 'jifen',
    rewardByRank: { 1: 1000, 2: 800, 3: 500 }
}

// 总开关：关闭时不注册任何事件/命令
if (!zombieActivityConfig.enabled) {
    return
}

// 数据持久化：写入世界存档（server.persistentData），重启/重载仍保留
const PERSIST_ROOT_KEY = 'zombieActivity'
// 客户端 HUD/榜单同步：服务端推送频道
const CLIENT_SYNC_CHANNEL = 'zombie_activity_hud'

const ZombieActivity = (() => {
    // 活动状态：内存态（关键字段会持久化）
    const state = {
        // 是否进行中
        running: false,
        // 是否由命令方块启动（用于广播/日志区分）
        startedFromCommandBlock: false,
        // 活动期间全服累计击杀
        totalKills: 0,
        // 本次活动目标击杀（每次 start 强制读取配置写入该字段）
        targetKills: Number(zombieActivityConfig.totalTargetKills) || DefaultTarget,
        // 玩家击杀映射：name -> kills
        playerKills: {},
        // 活动期间登录过的玩家集合：name -> true
        playersSeen: {},
        // 是否已达成（达成会触发 endActivity）
        completed: false,
        // 是否已结算发奖（防重复发放）
        rewarded: false,
        // 标题提示去重：单次活动每人一次
        titleSent: {},
        // 客户端同步节流：上次推送 tick
        lastClientSyncTick: 0
    }

    // 日志：服务端控制台
    function logInfo(message) {
        console.info('[ZombieActivity] ' + message)
    }

    // 错误日志：服务端控制台
    function logError(message) {
        console.error('[ZombieActivity] ' + message)
    }

    // 私聊输出：仅发给单个玩家
    function tellPlayer(player, message) {
        player.runCommandSilent(`tellraw @s ${JSON.stringify({ text: String(message) })}`)
    }

    // 公屏输出：全服广播
    function sayAll(server, message) {
        server.runCommandSilent('say ' + String(message))
    }

    // 命令来源：区分玩家/命令方块，并提取玩家名
    function getActor(source) {
        if (source.isPlayer && source.isPlayer()) {
            const player = source.getPlayerOrException()
            return { type: 'player', name: player.getName().getString(), player: player }
        }

        return { type: 'command_block', name: '命令方块', player: null }
    }

    function getPlayersSeenCount() {
        return Object.keys(state.playersSeen).length
    }

    function formatStatusLine() {
        return (
            'running=' +
            state.running +
            ' completed=' +
            state.completed +
            ' total=' +
            state.totalKills +
            '/' +
            state.targetKills +
            ' players=' +
            getPlayersSeenCount()
        )
    }

    function buildStatusMessage() {
        const statusText = state.running ? '开启' : '关闭'
        const progressText = state.totalKills + '/' + state.targetKills
        return '[ZombieActivity] 活动状态=' + statusText + ' 进度=(' + progressText + ')'
    }

    // status 输出策略：public=公屏；private=仅执行者；auto=玩家私聊/非玩家记日志
    function outputStatus(source, mode) {
        const server = source.getServer()
        const message = buildStatusMessage()

        if (mode === 'public') {
            sayAll(server, message)
            logInfo('status（公屏）: ' + message)
            return
        }

        if (source.isPlayer && source.isPlayer()) {
            const player = source.getPlayerOrException()
            tellPlayer(player, message)
            return
        }

        logInfo('status（非玩家源）: ' + message)
    }

    function buildClientPayload(playerName) {
        return {
            running: state.running,
            completed: state.completed,
            totalKills: state.totalKills,
            totalTargetKills: state.targetKills,
            topN: getTopNLimit(),
            selfKills: state.playerKills[playerName] || 0,
            top: getTopN()
        }
    }

    // 客户端同步：推送个人击杀/全服进度/TopN
    function sendClientSyncToPlayer(server, player) {
        const name = player.getName().getString()
        const payload = buildClientPayload(name)
        player.sendData(CLIENT_SYNC_CHANNEL, { json: JSON.stringify(payload) })
    }

    function sendClientSyncToOnline(server) {
        const list = server.players ? server.players.toArray() : []
        for (let i = 0; i < list.length; i++) {
            sendClientSyncToPlayer(server, list[i])
        }
    }

    // 持久化根节点：persistentData[zombieActivity]
    function getOrCreateRoot(server) {
        const pd = server.persistentData
        const root = pd.getCompound(PERSIST_ROOT_KEY)
        if (!pd.contains(PERSIST_ROOT_KEY, 10)) {
            pd.put(PERSIST_ROOT_KEY, root)
        }

        // 子节点：玩家击杀数映射
        const kills = root.getCompound('playerKills')
        if (!root.contains('playerKills', 10)) {
            root.put('playerKills', kills)
        }

        // 子节点：活动期间登录过的玩家集合
        const seen = root.getCompound('playersSeen')
        if (!root.contains('playersSeen', 10)) {
            root.put('playersSeen', seen)
        }

        // 子节点：已发送标题提示的玩家集合（单次活动内每人一次）
        const titleSent = root.getCompound('titleSent')
        if (!root.contains('titleSent', 10)) {
            root.put('titleSent', titleSent)
        }

        return root
    }

    // 持久化写入：内存 -> 世界存档
    function saveToPersistentData(server) {
        const root = getOrCreateRoot(server)
        root.putBoolean('running', state.running)
        root.putBoolean('startedFromCommandBlock', state.startedFromCommandBlock)
        root.putInt('totalKills', state.totalKills)
        root.putInt('targetKills', state.targetKills)
        root.putBoolean('completed', state.completed)
        root.putBoolean('rewarded', state.rewarded)

        // 覆盖写入 playerKills
        const killsTag = root.getCompound('playerKills')
        const oldKillKeys = killsTag.getAllKeys().toArray()
        for (let i = 0; i < oldKillKeys.length; i++) {
            killsTag.remove(String(oldKillKeys[i]))
        }
        Object.keys(state.playerKills).forEach(name => {
            killsTag.putInt(name, state.playerKills[name] || 0)
        })

        // 覆盖写入 playersSeen
        const seenTag = root.getCompound('playersSeen')
        const oldSeenKeys = seenTag.getAllKeys().toArray()
        for (let i = 0; i < oldSeenKeys.length; i++) {
            seenTag.remove(String(oldSeenKeys[i]))
        }
        Object.keys(state.playersSeen).forEach(name => {
            seenTag.putBoolean(name, true)
        })

        // 覆盖写入 titleSent
        const titleSentTag = root.getCompound('titleSent')
        const oldTitleKeys = titleSentTag.getAllKeys().toArray()
        for (let i = 0; i < oldTitleKeys.length; i++) {
            titleSentTag.remove(String(oldTitleKeys[i]))
        }
        Object.keys(state.titleSent).forEach(name => {
            titleSentTag.putBoolean(name, true)
        })
    }

    // 持久化读取：世界存档 -> 内存
    function loadFromPersistentData(server) {
        const root = getOrCreateRoot(server)

        state.running = root.getBoolean('running')
        state.startedFromCommandBlock = root.getBoolean('startedFromCommandBlock')
        state.totalKills = root.getInt('totalKills')
        state.targetKills = root.getInt('targetKills') || state.targetKills
        state.completed = root.getBoolean('completed')
        state.rewarded = root.getBoolean('rewarded')

        state.playerKills = {}
        state.playersSeen = {}
        state.titleSent = {}

        // 读取 playerKills
        const killsTag = root.getCompound('playerKills')
        const killKeys = killsTag.getAllKeys().toArray()
        for (let i = 0; i < killKeys.length; i++) {
            const name = String(killKeys[i])
            state.playerKills[name] = killsTag.getInt(name)
        }

        // 读取 playersSeen
        const seenTag = root.getCompound('playersSeen')
        const seenKeys = seenTag.getAllKeys().toArray()
        for (let i = 0; i < seenKeys.length; i++) {
            const name = String(seenKeys[i])
            state.playersSeen[name] = true
        }

        // 读取 titleSent
        const titleSentTag = root.getCompound('titleSent')
        const titleKeys = titleSentTag.getAllKeys().toArray()
        for (let i = 0; i < titleKeys.length; i++) {
            const name = String(titleKeys[i])
            state.titleSent[name] = true
        }
    }

    // 建档：保证玩家出现在全量榜单中（击杀数默认 0）
    function ensurePlayerRecord(playerName) {
        state.playersSeen[playerName] = true
        if (!(playerName in state.playerKills)) {
            state.playerKills[playerName] = 0
        }
    }

    // 标题提示：活动引导（每人一次）
    function sendActivityTitle(player) {
        player.runCommandSilent('title @s times 10 60 10')
        player.runCommandSilent('title @s title {"text":"全服活动正在进行中"}')
        player.runCommandSilent('title @s subtitle {"text":"请查看ftb任务书全服活动章节"}')
    }

    function trySendActivityTitle(server, player) {
        const name = player.getName().getString()
        if (state.titleSent[name]) return false

        state.titleSent[name] = true
        sendActivityTitle(player)
        saveToPersistentData(server)
        logInfo('发送标题提示：' + name)
        return true
    }

    function sendActivityTitleToOnline(server) {
        const list = server.players ? server.players.toArray() : []
        for (let i = 0; i < list.length; i++) {
            trySendActivityTitle(server, list[i])
        }
    }

    function buildWinners() {
        const rows = getTopN()
        return rows
            .map((row, index) => {
                const rank = index + 1
                const reward = zombieActivityConfig.rewardByRank ? zombieActivityConfig.rewardByRank[rank] : 0
                return { rank: rank, name: row.name, kills: row.kills, reward: Number(reward) || 0 }
            })
            .filter(w => w.reward > 0)
    }

    // 发奖：仅对 TopN 中 rewardByRank 配置的名次发放积分
    function awardTopN(server) {
        if (state.rewarded) return { ok: false, reason: 'already_rewarded', winners: [] }
        if (state.totalKills <= 0) return { ok: false, reason: 'zero_progress', winners: [] }

        const objective = String(zombieActivityConfig.rewardObjective || 'jifen')
        const winners = buildWinners()

        logInfo(`开始发放积分奖励：objective=${objective} winners=${winners.length}`)
        winners.forEach(w => {
            server.runCommandSilent(`scoreboard players add ${w.name} ${objective} ${w.reward}`)
            logInfo(`发放积分：#${w.rank} ${w.name} kills=${w.kills} +${w.reward}`)
        })

        state.rewarded = true
        saveToPersistentData(server)

        return { ok: true, reason: 'awarded', winners: winners }
    }

    function announceWinners(server, winners) {
        if (!winners.length) {
            sayAll(server, '[ZombieActivity] 本次结算无积分奖励（配置为 0 或无数据）')
            logInfo('结算无积分奖励：winners=0')
            return
        }

        sayAll(server, `[ZombieActivity] 积分奖励已发放（记分板：${zombieActivityConfig.rewardObjective}）`)
        winners.forEach(w => {
            const line = `[ZombieActivity] #${w.rank} ${w.name} 击杀=${w.kills} 奖励=${w.reward}`
            sayAll(server, line)
            logInfo('获奖公屏播报：' + line)
        })
    }

    // 结算：结束活动 + 发奖 + 清零（stop 与 end 的差异：stop 仅关闭，end 会结算）
    function endActivity(server, reason) {
        if (!state.running && !state.completed) {
            return { ok: false, reason: 'not_started' }
        }

        state.running = false
        state.completed = true

        const awardResult = awardTopN(server)
        if (awardResult.ok) {
            sayAll(server, `[ZombieActivity] 活动已结束（${reason}）`)
            announceWinners(server, awardResult.winners)
            logInfo(`活动结算完成（${reason}）；获奖人数=${awardResult.winners.length}`)
        } else {
            if (awardResult.reason === 'already_rewarded') {
                sayAll(server, `[ZombieActivity] 活动已结束（${reason}），但本次已结算过，跳过重复发奖`)
                logInfo(`活动重复结算被跳过（${reason}）`)
            } else if (awardResult.reason === 'zero_progress') {
                sayAll(server, `[ZombieActivity] 活动已结束（${reason}），全服进度为 0，跳过发奖`)
                logInfo(`活动结算跳过：全服进度为 0（${reason}）`)
            } else {
                sayAll(server, `[ZombieActivity] 活动已结束（${reason}），本次无可发放的积分奖励`)
                logInfo(`活动结算无积分奖励（${reason}）`)
            }
        }

        state.startedFromCommandBlock = false
        state.totalKills = 0
        state.playerKills = {}
        state.playersSeen = {}
        state.completed = false
        state.rewarded = false
        state.titleSent = {}
        saveToPersistentData(server)
        sendClientSyncToOnline(server)

        return { ok: true, reason: 'ended' }
    }

    // 服务器加载完成：初始化活动状态
    function onServerLoaded(event) {
        loadFromPersistentData(event.server)
        logInfo('服务器加载完成，读取存档：' + formatStatusLine())
    }

    function startBySource(source) {
        const server = source.getServer()
        const actor = getActor(source)

        if (state.running) {
            if (actor.player) {
                tellPlayer(actor.player, '[ZombieActivity] 活动已启动，无需重复启动')
            }
            logInfo('重复启动被忽略：' + actor.name)
            return false
        }

        state.running = true
        state.startedFromCommandBlock = actor.type !== 'player'
        state.totalKills = 0
        state.targetKills = Number(zombieActivityConfig.totalTargetKills) || DefaultTargtet
        state.playerKills = {}
        state.playersSeen = {}
        state.completed = false
        state.rewarded = false
        state.titleSent = {}

        const announce = actor.type === 'player' ? '活动已由 ' + actor.name + ' 启动' : '活动已由命令方块启动'
        server.runCommandSilent('say [ZombieActivity] ' + announce)
        logInfo(announce + '；' + formatStatusLine())

        saveToPersistentData(server)
        sendActivityTitleToOnline(server)
        sendClientSyncToOnline(server)
        return true
    }

    function stopBySource(source) {
        const server = source.getServer()
        const actor = getActor(source)

        if (!state.running) {
            if (actor.player) {
                tellPlayer(actor.player, '[ZombieActivity] 活动未开始，无法关闭')
            }
            logInfo('重复关闭被忽略：' + actor.name)
            return false
        }

        state.running = false

        const announce = actor.type === 'player' ? '活动已由 ' + actor.name + ' 关闭' : '活动已由命令方块关闭'
        server.runCommandSilent('say [ZombieActivity] ' + announce)
        logInfo(announce + '；' + formatStatusLine())

        state.startedFromCommandBlock = false
        state.totalKills = 0
        state.playerKills = {}
        state.playersSeen = {}
        state.completed = false
        state.rewarded = false
        state.titleSent = {}
        saveToPersistentData(server)
        sendClientSyncToOnline(server)
        return true
    }

    function endBySource(source) {
        const server = source.getServer()
        const actor = getActor(source)

        if (!state.running && !state.completed) {
            if (actor.player) tellPlayer(actor.player, '[ZombieActivity] 活动未开始，无法结算')
            logInfo('end 被忽略：活动未开始；actor=' + actor.name)
            return false
        }

        const announce = actor.type === 'player' ? '活动已由 ' + actor.name + ' 结算结束' : '活动已由命令方块结算结束'
        sayAll(server, '[ZombieActivity] ' + announce)
        logInfo(announce)
        endActivity(server, '手动结算')
        return true
    }

    // 活动状态查询
    function getStatus() {
        return {
            enabled: true,
            running: state.running,
            completed: state.completed,
            rewarded: state.rewarded,
            totalKills: state.totalKills,
            totalTargetKills: state.targetKills
        }
    }

    // 玩家登录：加入全量榜单（击杀数初始为 0）
    function onPlayerLoggedIn(event) {
        const name = event.player.getName().getString()
        ensurePlayerRecord(name)
        saveToPersistentData(event.server)
        sendClientSyncToPlayer(event.server, event.player)
        if (state.running && !state.completed) {
            trySendActivityTitle(event.server, event.player)
        }
    }

    // 玩家个人击杀数查询
    function getPlayerKills(playerName) {
        ensurePlayerRecord(playerName)
        return state.playerKills[playerName] || 0
    }

    // 僵尸死亡：统计击杀
    function onZombieDeath(event) {
        if (!state.running || state.completed) return
        const killer = event.source ? event.source.getPlayer() : null
        if (!killer) return

        const killerName = killer.getName().getString()
        ensurePlayerRecord(killerName)

        state.playerKills[killerName] = (state.playerKills[killerName] || 0) + 1
        state.totalKills = state.totalKills + 1

        if (state.totalKills >= state.targetKills) {
            state.completed = true
            event.server.runCommandSilent(
                `say [ZombieActivity] 全服击杀达到 ${state.targetKills}，活动完成`
            )
            logInfo('活动完成；' + formatStatusLine())
            endActivity(event.server, '进度达成')
        }

        saveToPersistentData(event.server)
    }

    function onServerTick(event) {
        if (!state.running) return
        const server = event.server
        const tick = server.getTickCount()
        if (tick - state.lastClientSyncTick < 20) return
        state.lastClientSyncTick = tick
        sendClientSyncToOnline(server)
    }

    function getSortedRows() {
        const rows = []
        const seen = state.playersSeen

        Object.keys(seen).forEach(name => {
            rows.push({ name: name, kills: state.playerKills[name] || 0 })
        })

        Object.keys(state.playerKills).forEach(name => {
            if (!seen[name]) {
                rows.push({ name: name, kills: state.playerKills[name] || 0 })
            }
        })

        rows.sort((a, b) => {
            if (b.kills !== a.kills) return b.kills - a.kills
            return a.name.localeCompare(b.name)
        })

        return rows
    }

    // TopN 排行榜
    function getTopN() {
        const rows = getSortedRows()
        return rows.slice(0, getTopNLimit())
    }

    function getTopNLimit() {
        const n = Number(zombieActivityConfig.topN)
        return n > 0 ? Math.floor(n) : 5
    }

    // 全量榜单
    function getAllRows() {
        return getSortedRows()
    }

    return {
        state: state,
        onServerLoaded: onServerLoaded,
        startBySource: startBySource,
        stopBySource: stopBySource,
        endBySource: endBySource,
        getStatus: getStatus,
        onPlayerLoggedIn: onPlayerLoggedIn,
        getPlayerKills: getPlayerKills,
        onZombieDeath: onZombieDeath,
        getTopN: getTopN,
        getTopNLimit: getTopNLimit,
        getAllRows: getAllRows,
        tellPlayer: tellPlayer,
        sayAll: sayAll,
        getActor: getActor,
        logInfo: logInfo,
        logError: logError,
        outputStatus: outputStatus,
        endActivity: endActivity,
        trySendActivityTitle: trySendActivityTitle,
        onServerTick: onServerTick
    }
})()

// 对外 API（供其他脚本/后续扩展调用）
global.zombieActivityAPI = global.zombieActivityAPI || {}
global.zombieActivityAPI.config = zombieActivityConfig
global.zombieActivityAPI.getStatus = () => ZombieActivity.getStatus()
global.zombieActivityAPI.start = source => ZombieActivity.startBySource(source)
global.zombieActivityAPI.stop = source => ZombieActivity.stopBySource(source)
global.zombieActivityAPI.end = source => ZombieActivity.endBySource(source)

// 服务器加载完成事件
ServerEvents.loaded(event => {
    ZombieActivity.onServerLoaded(event)
})

// 玩家登录事件
PlayerEvents.loggedIn(event => {
    ZombieActivity.onPlayerLoggedIn(event)
})

// 僵尸死亡：统计击杀（仅活动进行中）
EntityEvents.death('minecraft:zombie', event => {
    ZombieActivity.onZombieDeath(event)
})

// 客户端 HUD/榜单：周期性同步（节流至 1s 一次）
ServerEvents.tick(event => {
    ZombieActivity.onServerTick(event)
})

// 活动指令：start/stop/end/status/top/me/list
ServerEvents.commandRegistry(event => {
    const Commands = event.commands

    event.register(
        Commands.literal('zombie_activity')
            .then(
                Commands.literal('start')
                    .requires(src => src.hasPermission(2))
                    .executes(ctx => {
                        const src = ctx.source
                        ZombieActivity.startBySource(src)
                        return 1
                    })
            )
            .then(
                Commands.literal('stop')
                    .requires(src => src.hasPermission(2))
                    .executes(ctx => {
                        const src = ctx.source
                        ZombieActivity.stopBySource(src)
                        return 1
                    })
            )
            .then(
                Commands.literal('end')
                    .requires(src => src.hasPermission(2))
                    .executes(ctx => {
                        const src = ctx.source
                        ZombieActivity.endBySource(src)
                        return 1
                    })
            )
            .then(
                // 查看活动进度
                Commands.literal('status')
                    .executes(ctx => {
                        ZombieActivity.outputStatus(ctx.source, 'auto')
                        return 1
                    })
                    .then(
                        Commands.literal('public').executes(ctx => {
                            ZombieActivity.outputStatus(ctx.source, 'public')
                            return 1
                        })
                    )
                    .then(
                        Commands.literal('private').executes(ctx => {
                            ZombieActivity.outputStatus(ctx.source, 'private')
                            return 1
                        })
                    )
            )
            .then(
                // 查看前 N 名
                Commands.literal('top').executes(ctx => {
                    const src = ctx.source
                    if (!ZombieActivity.getStatus().running) {
                        if (src.isPlayer()) ZombieActivity.tellPlayer(src.getPlayerOrException(), '[ZombieActivity] 活动未开始')
                        return 0
                    }
                    if (!src.isPlayer()) {
                        ZombieActivity.logInfo('top（非玩家源）被忽略')
                        return 0
                    }
                    const player = src.getPlayerOrException()
                    const rows = ZombieActivity.getTopN()
                    if (!rows.length) {
                        ZombieActivity.tellPlayer(player, '[ZombieActivity] 暂无数据')
                        return 1
                    }
                    ZombieActivity.tellPlayer(player, '[ZombieActivity] Top' + ZombieActivity.getTopNLimit())
                    rows.forEach((row, i) => ZombieActivity.tellPlayer(player, '#' + (i + 1) + ' ' + row.name + ' - ' + row.kills))
                    return 1
                })
            )
            .then(
                // 查看自己击杀数
                Commands.literal('me').executes(ctx => {
                    const src = ctx.source
                    if (!src.isPlayer()) {
                        ZombieActivity.logInfo('me（非玩家源）被忽略')
                        return 0
                    }
                    if (!ZombieActivity.getStatus().running) {
                        ZombieActivity.tellPlayer(src.getPlayerOrException(), '[ZombieActivity] 活动未开始')
                        return 0
                    }
                    const player = src.getPlayerOrException()
                    const name = player.getName().getString()
                    const kills = ZombieActivity.getPlayerKills(name)
                    ZombieActivity.tellPlayer(player, '[ZombieActivity] 你的击杀数：' + kills)
                    return 1
                })
            )
            .then(
                // 查看全量榜单
                Commands.literal('list').executes(ctx => {
                    const src = ctx.source
                    if (!ZombieActivity.getStatus().running) {
                        if (src.isPlayer()) ZombieActivity.tellPlayer(src.getPlayerOrException(), '[ZombieActivity] 活动未开始')
                        return 0
                    }
                    if (!src.isPlayer()) {
                        ZombieActivity.logInfo('list（非玩家源）被忽略')
                        return 0
                    }
                    const player = src.getPlayerOrException()
                    const rows = ZombieActivity.getAllRows()
                    if (!rows.length) {
                        ZombieActivity.tellPlayer(player, '[ZombieActivity] 暂无数据')
                        return 1
                    }
                    ZombieActivity.tellPlayer(player, '[ZombieActivity] 全服榜单（' + rows.length + '）')
                    rows.forEach((row, i) => ZombieActivity.tellPlayer(player, '#' + (i + 1) + ' ' + row.name + ' - ' + row.kills))
                    return 1
                })
            )
    )
})

})()
