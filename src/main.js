import { createApp } from 'vue'
import App from './App.vue'

// 全局样式：变量 / 底图 / 旧版弹窗（标题、结算、菜单）
import '../css/style.css'

// 纯逻辑层：副作用导入，统一挂到 window.GB
import '../js/core.js'
import '../js/driver.js'
import '../js/data.js'
import '../js/map.js'
import '../js/battle.js'
import '../js/ai.js'
import '../js/run.js'
import '../js/shop.js'
import '../js/render.js'
import '../js/ui.js'

import { installBridge } from './store.js'
installBridge()
createApp(App).mount('#app')
