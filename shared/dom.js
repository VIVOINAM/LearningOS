"use strict";

/**
 * 共用的 DOM 构造辅助。
 *
 * 此前 el / node / btn / button 在六个文件里各写了一遍，签名还互不相同
 * （有的第三参是 class，有的是 text；有的 class 为空写 ''，有的写 undefined），
 * 改一处行为要同步好几份。这里统一成两个函数。
 *
 * el(parent, tag, cls, text)      —— 建元素并挂到 parent
 * btn(parent, label, action, cls) —— 建按钮，自动串行化点击、捕获异常
 */

/** 建元素。cls 与 text 都可省略；text 为 undefined 时不碰 textContent。 */
function el(parent, tag = "div", cls = "", text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

/**
 * 建按钮。点击期间禁用自身，避免重复提交；
 * onError 未提供时异常只记录到 console，由调用方决定是否提示。
 */
function btn(parent, label, action, cls = "", onError) {
  const node = el(parent, "button", cls, label);
  node.type = "button";
  node.addEventListener("click", async event => {
    event.stopPropagation();
    if (node.disabled) return;
    node.disabled = true;
    try {
      await action(event);
    } catch (error) {
      console.error(error);
      onError?.(error);
    } finally {
      node.disabled = false;
    }
  });
  return node;
}

module.exports = { el, btn };
