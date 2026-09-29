export const netErrorText = (err) => {
  const m = String((err && err.message) || err || "");
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED|network/i.test(m)) {
    return "无法连接服务，请检查网络后重试";
  }
  return m || "网络异常，请重试";
};
