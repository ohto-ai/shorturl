/**
 * 服务 Logo:暗色圆角底 + 一长一短两节链环(“短链”的视觉隐喻)。
 * 用途:/favicon.ico、/favicon.svg、/logo.svg 路由,以及管理页/错误页内嵌。
 * 64×64 viewBox,渐变与后台主题色一致(--accent → --ok)。
 */
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
  '<defs><linearGradient id="lg" x1="14" y1="46" x2="50" y2="18" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#5b9dff"/><stop offset="1" stop-color="#3ecf8e"/>' +
  "</linearGradient></defs>" +
  '<rect x="2.5" y="2.5" width="59" height="59" rx="14" fill="#0f1115" stroke="#2a3040" stroke-width="1"/>' +
  '<g transform="rotate(-45 32 32)" fill="none" stroke="url(#lg)" stroke-width="4" stroke-linejoin="round">' +
  '<rect x="14" y="24" width="26" height="16" rx="8"/>' +
  '<rect x="36" y="24" width="14" height="16" rx="8"/>' +
  "</g></svg>";
