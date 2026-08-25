/**
 * 插件行链接的打开方式。
 *
 * 站点默认在新标签打开：列表是浏览入口，用户常常要连开一串插件对比。
 * 但把同一份前端塞进移动端 webview 容器时，target=_blank 可能被容器直接吞掉——
 * 点了没有任何反应，比在同标签内跳转糟得多。那类构建用
 * VITE_ROW_LINKS_SAME_TAB=true 关掉新标签。
 */
export const ROW_LINK_TARGET: '_blank' | undefined =
  import.meta.env.VITE_ROW_LINKS_SAME_TAB === 'true' ? undefined : '_blank'
