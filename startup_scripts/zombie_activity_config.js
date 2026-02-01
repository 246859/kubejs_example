// 全服僵尸活动：配置入口（改这里即可开关/调参）
global.zombieActivityConfig = {
    // 功能开关：false 时不加载活动相关功能
    enabled: true,
    // 活动目标：全服击杀达到该值判定完成（每次 start 会读取该值写入活动 state）
    totalTargetKills: 10,
    // 排行榜展示数量：TopN（客户端右侧榜单 & /zombie_activity top）
    topN: 5,
    // 积分记分板：结算时写入该 objective（scoreboard players add）
    rewardObjective: 'jifen',
    // 排名奖励（名次: 分数）：仅对 rewardByRank 中配置的名次发放
    rewardByRank: {
        1: 1000,
        2: 800,
        3: 500
    }
}

// 对外 API 占位（后续会在 server_scripts 内填充实现）
global.zombieActivityAPI = global.zombieActivityAPI || {}

