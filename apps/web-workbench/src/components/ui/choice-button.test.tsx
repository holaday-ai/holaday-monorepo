// @vitest-environment happy-dom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import {useState} from 'react';
import {ChoiceButton} from './choice-button';
afterEach(cleanup);
describe('shared choice button',()=>{
 it('exposes and updates the exclusive selection without changing native disabled behavior',()=>{
  function Choices(){const [value,setValue]=useState('密码');return <>{['密码','手机','禁用'].map(x=><ChoiceButton key={x} selected={value===x} disabled={x==='禁用'} onClick={()=>setValue(x)}>{x}</ChoiceButton>)}</>}
  render(<Choices/>);
  expect(screen.getByRole('button',{name:'密码',pressed:true})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'手机'}));
  expect(screen.getByRole('button',{name:'手机',pressed:true})).toBeTruthy();
  expect(screen.getByRole('button',{name:'密码',pressed:false})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'禁用'}));
  expect(screen.getByRole('button',{name:'禁用',pressed:false})).toHaveProperty('disabled',true);
 });
});
