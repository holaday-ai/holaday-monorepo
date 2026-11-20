import assert from 'node:assert/strict';
import path from 'node:path';
export async function p2Checks(page, route, width, out) {
  const checks=[];
  if(route === '/settings') {
    const metrics=await page.getByRole('navigation',{name:'设置分区'}).evaluate(nav=>{
      const style=getComputedStyle(nav), cover=getComputedStyle(nav,'::before');
      return { background:style.backgroundColor,cover:cover.backgroundColor,coverTop:parseFloat(cover.top),coverHeight:parseFloat(cover.height),links:[...nav.querySelectorAll('a')].map(link=>{const range=document.createRange();range.selectNodeContents(link);return {label:link.textContent,lines:[...range.getClientRects()].length,nowrap:getComputedStyle(link).whiteSpace}})};
    });
    for(const link of metrics.links){assert.equal(link.nowrap,'nowrap',link.label);assert.ok(link.lines<=1,`${link.label} wraps`)}
    assert.match(metrics.background,/^rgb\(/,'settings navigation must be opaque');
    assert.match(metrics.cover,/^rgb\(/,'sticky gap must have an opaque cover');
    assert.ok(metrics.coverTop<=-8&&metrics.coverHeight>=8);
    checks.push({item:'p2-settings-nowrap-cover',metrics});
  }
  if(route === '/cosmic') {
    const header=await page.locator('.holaday-page-header').boundingBox();
    const first=await page.locator('#energy-recharge').boundingBox();
    const gap=first.y-header.y-header.height;
    assert.ok(gap>=12&&gap<=40,`energy header/card gap ${gap}`);
    checks.push({item:'p2-energy-gap',gap});
  }
  if(route === 'task:browser:completed') {
    assert.equal(await page.getByText('0/2 阶段完成',{exact:true}).count(),0);
    assert.equal(await page.getByText('执行计划',{exact:true}).count(),0);
    checks.push({item:'p2-terminal-plan-hidden'});
  }
  if(checks.length) {
    const screenshot=`p2-${width}-${route.replace(/\W/g,'_')}.jpg`;
    await page.screenshot({path:path.join(out,screenshot),animations:'disabled'});
    for(const check of checks)check.screenshot=screenshot;
  }
  return checks;
}
