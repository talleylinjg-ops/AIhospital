export const netErrorText = (err) => {
  const m = String((err && err.message) || err || "");
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED|network/i.test(m)) {
    return "无法连接服务，请检查网络后重试";
  }
  if (/Bad Gateway|Gateway Timeout|Service Unavailable|Internal Server Error|502|503|504/i.test(m)) {
    return "服务暂时不可用，请稍后重试";
  }
  if (/Unexpected token|Unexpected end of JSON|not valid JSON|JSON\.parse/i.test(m)) {
    return "服务响应异常，请稍后重试";
  }
  return m || "网络异常，请重试";
};
