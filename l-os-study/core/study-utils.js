"use strict";

/** L-OS 3.0 · PDF 学习模块基础工具。 */

const clean = (value) => String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim();

const { day } = require("../../shared/date");

const isTextbook = (file) => Boolean(file) && /\.pdf$/i.test(String(file.path || ""));

module.exports = { clean, day, isTextbook };