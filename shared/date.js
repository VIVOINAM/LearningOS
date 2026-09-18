"use strict";

/** Local calendar date; do not convert to UTC (daily notes follow local time). */
function day(time = Date.now()) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

module.exports = { day };
