"use strict";

/**
 * 截止日期的状态判定。
 *
 * 原本和天气一起住在 environment.js 里——那个文件的名字叫「环境」，
 * 实际装的是一个联网天气组件加这一个纯函数。6.1 删掉天气之后只剩它，
 * 于是搬到自己的文件里。
 */

function dueState(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y,m,d] = value.split('-').map(Number), stamp = Date.UTC(y,m-1,d);
  if (new Date(stamp).toISOString().slice(0,10) !== value) return null;
  const days = Math.round((stamp-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);
  return {days, label:days<0?`逾期 ${-days} 天`:days===0?'今天截止':`剩余 ${days} 天`, level:days<0?'overdue':days<=3?'soon':'normal'};
}

module.exports = {dueState};
