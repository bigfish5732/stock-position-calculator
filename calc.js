'use strict';

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

// 总金额 -> 最多持股数 与 单票仓位上限
function calcPortfolio(totalCapital, maxStocks) {
  const capital = Number(totalCapital) || 0;
  const stocks = Math.max(1, Math.floor(Number(maxStocks) || 1));
  const perStockPct = round2(100 / stocks);
  const perStockAmount = round2(capital / stocks);
  return { maxStocks: stocks, perStockPct, perStockAmount };
}

// 单票仓位 / 分批买入 / 止损止盈 计算
function calcPosition(p) {
  const totalCapital = Number(p.totalCapital) || 0;
  const price = Number(p.price) || 0;
  const maxSinglePct = Number(p.maxSinglePct) || 0;
  const stopLossPct = Number(p.stopLossPct) || 0;
  const takeProfitPct = Number(p.takeProfitPct) || 0;
  const addTimes = Math.max(0, Math.floor(Number(p.addTimes) || 0));
  const lotSize = Math.max(1, Math.floor(Number(p.lotSize) || 100));
  const tpSellPct = clamp(Number(p.tpSellPct ?? 50) || 0, 0, 100);
  const slSellPct = clamp(Number(p.slSellPct ?? 50) || 0, 0, 100);

  // 单票最大仓位
  const capAmount = totalCapital * maxSinglePct / 100; // 单票仓位金额上限
  const maxLots = (price > 0 && lotSize > 0) ? Math.floor(capAmount / price / lotSize) : 0;
  const maxShares = maxLots * lotSize;
  const actualCapAmount = round2(maxShares * price);

  // 分批买入（加仓次数 + 1 批；加仓次数为 0 时只有第一次买入）
  // 若可买手数不足以分那么多批，则按可买手数自动减少批数，避免出现空批次
  const totalLots = maxLots;
  const numBatches = Math.max(1, Math.min(addTimes + 1, Math.max(1, totalLots)));
  const baseLots = Math.floor(totalLots / numBatches);
  const remLots = totalLots - baseLots * numBatches;
  const names = ['第一次买入', '第二次买入', '第三次买入', '第四次买入', '第五次买入',
    '第六次买入', '第七次买入', '第八次买入', '第九次买入', '第十次买入'];
  const batches = [];
  for (let i = 0; i < numBatches; i++) {
    const lots = baseLots + (i < remLots ? 1 : 0);
    const shares = lots * lotSize;
    const amount = round2(shares * price);
    batches.push({
      index: i + 1,
      name: names[i] || ('第' + (i + 1) + '次买入'),
      shares,
      amount,
      stopLossLoss: round2(amount * stopLossPct / 100),
      takeProfitGain: round2(amount * takeProfitPct / 100),
    });
  }

  // 止损价 / 止盈价
  const stopLossPrice = round2(price * (1 - stopLossPct / 100));
  const takeProfitPrice = round2(price * (1 + takeProfitPct / 100));

  // 全额止损的总回撤 / 全额止盈的总盈利
  const totalStopLoss = round2(actualCapAmount * stopLossPct / 100);
  const totalTakeProfit = round2(actualCapAmount * takeProfitPct / 100);

  // 分批止盈：到止盈价卖出 tpSellPct%，锁定利润、保留底仓
  const tpSellShares = Math.floor(maxShares * tpSellPct / 100 / lotSize) * lotSize;
  const tpKeepShares = maxShares - tpSellShares;
  const tpSellAmount = round2(tpSellShares * takeProfitPrice);
  const tpLockedProfit = round2(tpSellShares * (takeProfitPrice - price));
  const tpKeepAmount = round2(tpKeepShares * takeProfitPrice);

  // 分批止损：到止损价卖出 slSellPct%，减少亏损、保留部分观察
  const slSellShares = Math.floor(maxShares * slSellPct / 100 / lotSize) * lotSize;
  const slKeepShares = maxShares - slSellShares;
  const slSellAmount = round2(slSellShares * stopLossPrice);
  const slReducedLoss = round2(slSellShares * (price - stopLossPrice)); // 减仓部分少亏的钱
  const slFullLoss = round2(maxShares * (price - stopLossPrice)); // 完全止损亏的钱

  return {
    capAmount: round2(capAmount),
    maxLots,
    maxShares,
    actualCapAmount,
    numBatches,
    batches,
    stopLossPrice,
    takeProfitPrice,
    totalStopLoss,
    totalTakeProfit,
    tpSellPct,
    tpSellShares,
    tpKeepShares,
    tpSellAmount,
    tpLockedProfit,
    tpKeepAmount,
    slSellPct,
    slSellShares,
    slKeepShares,
    slSellAmount,
    slReducedLoss,
    slFullLoss,
  };
}

module.exports = { round2, clamp, calcPortfolio, calcPosition };
