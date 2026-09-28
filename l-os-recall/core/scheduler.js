"use strict";
const DAY = 86400000;
function schedule(previous = {}, rating, now = Date.now()) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw Error('无效复习评分');
  const ease = Math.max(1.3, Math.min(3, (Number(previous.ease) || 2.3) + ({again:-0.2,hard:-0.15,good:0,easy:0.15}[rating])));
  const old = Math.max(0, Number(previous.interval) || 0);
  const interval = Math.min(365, rating === 'again' ? 0 : rating === 'hard' ? Math.max(1, Math.round(old * 1.2)) : rating === 'easy' ? Math.max(4, Math.round(old * ease * 1.3)) : Math.max(old ? 3 : 1, Math.round(old * ease)));
  return {ease, interval, due:now + (rating === 'again' ? 10 * 60000 : interval * DAY), reviewedAt:now, reviews:(Number(previous.reviews) || 0) + 1, lapses:(Number(previous.lapses) || 0) + (rating === 'again' ? 1 : 0)};
}
module.exports = {schedule};
