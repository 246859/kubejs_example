;(function () {
// 全服僵尸活动：客户端占位（后续做 HUD/右侧榜单展示）
let zombieActivityConfig = global.zombieActivityConfig || { enabled: true }

// 总开关：关闭时不注册客户端事件
if (!zombieActivityConfig.enabled) {
    return
}

let CHANNEL = 'zombie_activity_hud'
let lastPayload = null
let lastPayloadTick = 0

// HUD 文本位置：物品栏上方（随分辨率变化）
let HUD_X = function (w) {
    return Math.floor(w / 2 - 60)
}
let HUD_Y = function (h) {
    return h - 55
}
// TopN 列表位置：右上角（随分辨率变化）
let TOP_X = function (w) {
    return w - 140
}
let TOP_Y = function (h, visibleRows) {
    return 12
}

// HUD 渲染：个人击杀 + 全服进度
let paintHUD = function (event, payload) {
    let selfKills = Number(payload.selfKills) || 0
    let totalKills = Number(payload.totalKills) || 0
    let target = Number(payload.totalTargetKills) || 0

    let line1 = '[全服活动] 个人击杀：' + selfKills
    let line2 = '[全服活动] 进度：' + totalKills + '/' + target

    let x1 = HUD_X(event.width)
    let y1 = HUD_Y(event.height)
    event.text(line1, x1, y1, 0xffffff, true)
    event.text(line2, x1, y1 + 10, 0xffffff, true)
}

// TopN 渲染：击杀排行榜（含离线玩家，由服务端同步）
let paintTopN = function (event, payload) {
    let top = Array.isArray(payload.top) ? payload.top : []
    let baseX = TOP_X(event.width)
    let topN = Number(payload.topN) || 5
    let baseY = TOP_Y(event.height, top.length)

    event.text('全服击杀 Top' + topN, baseX, baseY, 0xffff55, true)
    for (let i = 0; i < top.length; i++) {
        let row = top[i] || {}
        let name = String(row.name || '?')
        let kills = Number(row.kills) || 0
        event.text('#' + (i + 1) + ' ' + name + ' - ' + kills, baseX, baseY + 12 + i * 10, 0xffffff, true)
    }
}

// 网络同步：接收服务端推送的 HUD/榜单数据
NetworkEvents.dataReceived(CHANNEL, function (event) {
    try {
        let json = event.data.getString('json')
        lastPayload = JSON.parse(String(json))
        lastPayloadTick = Client.player ? Client.player.tickCount : 0
    } catch (e) {
        lastPayload = null
    }
})

// 屏幕渲染：活动进行中才显示（避免常驻遮挡）
ClientEvents.paintScreen(function (event) {
    if (event.inventory) return
    if (!lastPayload) return
    if (!lastPayload.running) return

    paintHUD(event, lastPayload)
    paintTopN(event, lastPayload)
})

})()
