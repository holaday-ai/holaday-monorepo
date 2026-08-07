export interface GeneralTaskIntakeIssue {
  kind: 'missing_input' | 'contradiction';
  field: 'delivery_location' | 'product' | 'priority';
  question: string;
}

/**
 * Cheap, deterministic intake guard for common web-execution requests.
 * It only fires on strong placeholders or inputs that materially affect
 * the result; ambiguous wording is left to the normal planner.
 */
export function assessGeneralTaskIntake(intent: string): GeneralTaskIntakeIssue | null {
  const text = intent.trim();
  if (!text) return null;

  const comparisonCue = /对比|比较|比价|哪(?:个|家).*划算/u.test(text);
  if (comparisonCue && /某(?:个|款|种)?商品|某商品|一个商品|指定商品/u.test(text)) {
    return {
      kind: 'missing_input',
      field: 'product',
      question: '请告诉我要对比的具体商品名称或型号；有规格、容量或颜色要求也请一起提供。',
    };
  }

  const sameDayDelivery = /今天送达|今日送达|当天送达|当日达|same[- ]?day delivery/i.test(text);
  const shoppingCue =
    /商品|购买|下单|价格|便宜|商城|电商|淘宝|京东|天猫|拼多多|amazon|咖啡机|手机|电脑/i.test(text);
  if (sameDayDelivery && shoppingCue && !containsDeliveryLocation(text)) {
    return {
      kind: 'missing_input',
      field: 'delivery_location',
      question: '当天送达取决于收货地。请提供城市和区县（无需填写详细门牌号）。',
    };
  }

  return null;
}

function containsDeliveryLocation(text: string): boolean {
  return (
    /(?:收货地|配送地|送到|寄到|地址|城市|区县)[：:]?\s*[\p{Script=Han}A-Za-z]{2,}/u.test(text) ||
    /(?:北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|长沙|郑州|青岛|厦门|福州|济南|合肥|宁波|无锡|东莞|佛山|日本|东京|大阪|横滨|新加坡)/u.test(
      text,
    )
  );
}
