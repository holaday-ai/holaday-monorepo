import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as derived from './browser-cutover-evidence.mjs';
function recoveryCensusFixture() {
  const boot = '12345678-1234-4234-8234-123456789def';
  const files = new Map([['/proc/sys/kernel/random/boot_id', `${boot}\n`]]);
  const links = new Map();
  const names = ['1', '7', '8', '20', '40', 'self'];
  for (const [pid, state, flags, exe, ppid] of [
    [1, 'S', 0, '/sbin/init', 0],
    [7, 'S', 2097152, '', 0],
    [8, 'Z', 0, '', 1],
    [20, 'S', 0, '/opt/node22/bin/node', 1],
    [40, 'S', 0, '/bin/sleep', 1],
  ]) {
    const fields = [state, String(ppid), ...Array(17).fill('0'), String(pid * 10)];
    fields[6] = String(flags);
    files.set(`/proc/${pid}/stat`, `${pid} (process) ${fields.join(' ')}\n`);
    files.set(
      `/proc/${pid}/status`,
      `State:\t${state}\nPPid:\t${ppid}\nUid:\t0\t0\t0\t0\nNoNewPrivs:\t1\n${['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((key) => `${key}:\t0000000000000000\n`).join('')}`,
    );
    files.set(`/proc/${pid}/cmdline`, exe ? `${exe}\0private-argument\0` : '');
    files.set(`/proc/${pid}/cgroup`, '0::/shared.slice\n');
    links.set(`/proc/${pid}/exe`, exe);
    links.set(`/proc/${pid}/cwd`, '/');
    links.set(`/proc/${pid}/ns/mnt`, 'mnt:[1]');
  }
  const io = {
    platform: 'linux',
    uid: 0,
    hostname: () => 'native-qa',
    now: () => 1000,
    readdir: async () => [...names],
    readlink: async (path) => {
      assert.ok(links.has(path), path);
      return links.get(path);
    },
    open: async (path) => {
      assert.ok(files.has(path), path);
      const bytes = Buffer.from(files.get(path));
      return {
        read: async (buffer, offset, length, position) => {
          const bytesRead = Math.max(0, Math.min(length, bytes.length - position));
          bytes.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
        close: async () => {},
      };
    },
  };
  return { io, files, links, names, boot };
}

for (const mode of [
  'success',
  'clock',
  'host',
  'count',
  'state',
  'read',
  'changed',
  'ENOENT',
  'EACCES',
]) {
  test(`nested census fixed classification: ${mode}`, async () => {
    async function run(module) {
      const f = recoveryCensusFixture();
      const calls = [];
      if (mode === 'clock') f.io.now = () => Number.NaN;
      if (mode === 'host') f.io.uid = 1;
      if (mode === 'count') f.names.push('40');
      if (mode === 'state')
        f.files.set('/proc/40/stat', f.files.get('/proc/40/stat').replace(' S ', ' X '));
      if (mode === 'read')
        f.io.open = async () => ({ read: async () => ({ bytesRead: -1 }), close: async () => {} });
      if (mode === 'changed') {
        let n = 0;
        const orig = f.io.readdir;
        f.io.readdir = async (...a) => {
          if (++n === 2) f.files.set('/proc/40/cmdline', '/bin/sleep\0secret-changed\0');
          return orig(...a);
        };
      }
      if (mode === 'ENOENT' || mode === 'EACCES')
        f.io.open = async () => {
          throw Object.assign(new Error('SECRET'), { code: mode });
        };
      for (const key of ['readdir', 'readlink', 'open']) {
        const original = f.io[key];
        f.io[key] = async (...a) => {
          calls.push([key, ...a]);
          return original(...a);
        };
      }
      let result;
      let error;
      try {
        result = await module.readFirstCutoverCloudRecoveryCensus(f.io);
      } catch (e) {
        error = e;
      }
      return { result, error, calls };
    }
    const current = await run(derived);
    if (mode === 'success') assert.equal(current.result.processes.length, 3);
    else assert.equal(current.error.message, 'CUTOVER_CLOUD_RECOVERY_CENSUS_UNPROVEN');
    const metadata = derived.readCutoverCloudObservationDiagnostic(current.error);
    if (mode === 'success') assert.equal(metadata, undefined);
    else {
      assert.ok(metadata);
      assert.match(metadata.failureStage ?? metadata.lastEnteredStage, /^(HOST|CENSUS)_/);
      assert.equal(JSON.stringify(metadata).includes('SECRET'), false);
    }
  });
}
test('own descriptors: getters, proxies and toJSON never execute', () => {
  let calls = 0;
  for (const cause of [
    Object.defineProperty({}, 'code', {
      get() {
        calls++;
        throw Error('SECRET');
      },
    }),
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          calls++;
          throw Error('SECRET');
        },
      },
    ),
    {
      toJSON() {
        calls++;
        throw Error('SECRET');
      },
    },
    'SECRET',
    null,
  ]) {
    const before = calls;
    const error = derived.cutoverCloudObservationError('PUBLIC', 'DISPLAY_R01', cause);
    const diagnostic = derived.readCutoverCloudObservationDiagnostic(error);
    assert.deepEqual(diagnostic, { failureStage: 'DISPLAY_R01', errno: null });
    assert.ok(calls - before <= 1);
    assert.equal(JSON.stringify(diagnostic).includes('SECRET'), false);
  }
  assert.equal(calls, 1);
});
test('nested trusted classification survives wrapper; arbitrary fields cannot spoof', () => {
  const leaf = derived.cutoverCloudObservationError('PUBLIC', 'HOST_T01', { code: 'ENOENT' });
  const wrapped = derived.cutoverCloudObservationError('PUBLIC', 'DISPLAY_IO_01', leaf);
  assert.deepEqual(derived.readCutoverCloudObservationDiagnostic(wrapped), {
    failureStage: 'HOST_T01',
    errno: 'ENOENT',
  });
  assert.equal(
    derived.readCutoverCloudObservationDiagnostic({ cloudDiagnostic: { stage: 'HOST_T01' } }),
    undefined,
  );
});

import { createHash } from 'node:crypto';
import * as firstRuntime from './browser-first-cutover-runtime.mjs';
const { cutoverRegistrationConfigDigest } = derived;
async function sourceNativeFixture() {
  // Synthetic physical IO. Public PM2/entry bytes only, no production env.
  const { inflateSync } = await import('node:zlib');
  // Frozen public PM2 6.0.14 source + reviewed entry, compressed only for test size.
  const { pm2: publicSources, entry } = JSON.parse(
    inflateSync(
      Buffer.from(
        'eJztfQtX3Eay8F9pk8SasQfNAH4OIQnBJMuuDT6AN99+wB1rpJ5BRiPp6sEjhv/+nap+t1ozA7b329xzfU4CqLurX9XV1fX8vJLP1leGn1cuaVHGWboyXHnhD/y1Zyu9lTLMcroyXAmD8JxGq3k9TuJwNcwiupqlyc1qmlWreZFFdVjFWbqaZEFEo9Uyq4uQrvRWJnFCy5XhyeeVPKjOV4YrSTzu/55F/d+y4uJdFlH/U7nSW4niKS2rleHKRrQ2ef4yonTt9eDF4NWL9fGzV89fjNeeh9GLtTB4NngxePaSvnj+avBy7cXgNX3+7HkQPqdr9OXL58/DMY6Y9T1c6T95cpqSJ2Qny2+KeHpekfXB2sbq+mB9nVTnlLx/t07yIvtEw4oEdXWeFaVPtpOEYOWSFLSkxSWNfITyoaQkm5DqPC4J64LAKpC4JNPskhYpjcj4hgQkiUOalpRU50GFLcMgJWNKJlmdRiROse+3ezu7+0e7BNYH4fdPU68uKSmrIg4rb/M0PU3FBH6BWgRWjNBrGtaw0qSgSVDRiEzqFJe+ZFXZRMh2Qq+DNCooOaqKP2lCr+LwT/JjUP5Sp3FFw3M/zn5iLcQSvH+3zgdyGRQkyaZE/dsiBf3vOi5ox4vouJ563Y6Xz9aHk6y4GM2yiHrdTdZuUhJ3u0kp63yo4iSubpp1fL/Py/xPqjpgjhMkFMhaUXDzqXQOGApktZLOLmlhVGCfvC6rEJaVewK+3/f9fpilZRWkVSlGqLbpDS3DIs5hM9jKzmh1nkWEXudZUfH9yYMimJHPd+T3LGJfClrVRcqXfpZFdUJ93oRsye0l4sB0fs+iLvl8mhLCOibkCRSSIElIkOclWSW/HRz+g7w7eLPLi2GbEO2CPOefxOAmHKz4LMeXz9ZHNL1sfA/H4pMcOMGhE5iSL+DpQxffOhxmj4RjPgVCcM2z2SxII7JFPMB88TkopiXbhJMzXGn4AzYgS6ifZNPOx+08Jyfff+Zw/TSY0buh+jufjeLo7oyUVVBUcTqF07eKiwE4u/qxq/oq8+Aq1bc7PI+TaJQXWUjL0uv6WEGOAprEaUWLvKAVLciWWC8fTuhIL7q9JRwKlr0PqnNtjnkc/Qanm81TG3geR6Oc1WW14wnp6HAfbW0RL81S6sm1JNpKalUlCAZErlYW0RGu8ePHZLsoghs/LvFns0pX64OwjdnCH36YpWFQOVpsivp3qvt+n7yheUFDJF2rpMpIQWfZJSVBRcpsRkmexWlljFasXXrpv3+3Pto/eLM7Onh/vHewf7RwUHPa+mWexFXHI17XOVR7ubfYckfUgx09pNPd67yDH773un5Fy0qv3lwvP6/L8w7sqF/QMksuKfsjigtA2w4/+UDq4e9uj3i+7/WI955NYidLqyBOaQGEAImPMWz2C01Kao/cj9MwqSNadrxxnXpdnElV1PTbDvHXOp03SmfPCvvxFEHnojlvjBN0YLurqeyYY8YJOVPA1JkSTRFpFew5OK6jtwTV75M8zoHIlFVBgxnJ8HLXKEwVAUDZQVZXQ33cWV2NkmyKQ+/JpSoKoxItClmJD2BTGwFNq7igeHmXVQTTSynsTFDc+GrGXj6TQDygibyDrhwbjNUHCMbKijb21IEUn65AmyH54dPpSg/bd+XAxJ2OZPhtNp3G6bQDVXryjujQougBx1UnlbYJMFpaFAamwi2TZNPtNPqdprQIKrpbFFmB9TZVNXY7kXBsFtxpxLAqbnTAsEkZXt/GPuE2pJfsF7kZPb04ohWyx2SIB8soC68iqyksJXzVLobwKup0jWZlFcUZa3bi5XFO4ZzZP+M89M5Iv38UzCgJSrxoO13YUaBLJMwK7ZxptI0tbHWT02wisfoqTqPsqvxbHFFGI05XxlmW0CA9Xemay8FXSW+iYYr2VduPO+vstsOBJdycM27RTx1HLeOqYx1z6zhaAtq0FdrUgDZthca4xxyYAWQWOpw89ZCI9AQ8DRdJGFTheYcuh98t2N16ez3CwdzeEvwFjjMtzL+zuuraJ2ASVEGCPZItktIrwnoXNJ6EWZ1EJM0q9qYpLmgEaJzTIrnpkfCchhfkJqsLUt6UFZ2RcxokwKYvnqDq2T1TV7k2ZZwUP1Bwfu82XSV+jrvJPsWRVYftsdptjVhIbrYqgrScZMXsbTY9zv5eZqnia+FI9UgUVIGxrnwOfz862PfhgZdO48lNx0C2GVDpKSVDbO1X2RHWs6hCFc9oWQWzXKMmQJWjoKIjGFNQkZ/ZU6jT9dmHTkvFLhni/r4JKtrp+lW2d3Tg7vQmh3Hh3PTvfEVHMdA9ff0Y323UDfJ8BDyDXRO+acepS54S7/Q09Rz7KzcgL+gkvn6bTf+Iq3McvVz/xsrzpyzMO8B3hCrSPltLLlhDGEjXpBaikZ/QdFqdk5/IWlefpyzPs7zTdXYmq8yCvJPEKSVbP5GP339ectfuhuT7z9Ds7vQ0/bigi09ZnHY8fRIcFUWNtnPEiIWfpfB+rgKvZ77mdoviTVAFnUXrndZJsqnTyH6fXMYBWV3N6or0I3rZhypkdRVIk/zbTaGjuAzGCQU2pNSYWD6jSZCUdLONusOYEI8fPyaNb8jafyozY7eNBZ135j1aFB5HPdVccuJt+9jS0yLkNntoAWLhs7EqQH3HdenTGaB4kk2HbPyfHUebDM3PhODJZr8uPPOE4Il31oYSq3JBL4ms3DFqc7kkMNePH5OWIr+glzH83iU/L6wDtK9OEsd4yzwIqXO8WKI3uDNJXAWtBK87pRUjrCajCPszbJw+oHwN1BWQ8EoFqcFeuV8nSaflNdAljx/rXXUeOTh3uP2XgCthdi2WyDprcvT62OXb4fFj+bt/VcQVbX6R9FS/8bEK0ANRHSiRCUB+cQAwllLjdFqJ2UFdPYyYLSZOc9bu30+nsrr6z6ZT88kUG/7/kqm/HpnSJRvfiEwtddC+DmUCzkVUB7JiApBfFlEmIbwnKEz/tciCKAzKSj4EqoyrCHiVvkHSgJbxmjY5e8c+d2bl1KBm/SeL/mmL+ITsTeAZR2gUV0zpJToxar3JUK9QwgmKU7KT1GVFC67YI4/0uov+9U28mpVTH/Hw8WMCvwMF7DqPv5/S6+o4Di86UprUtQkCxwmDqgio5GfZARkSj0MdzsqpTW/E+SFk8RmS5wjritk0qrSSMHJvMkbuS8rgn0azhm3kqKWfe5Agoot/+Z/6wbL+1KoKoZFeVwmvYF0J3IrZGHSYHiALyuRHfPQo3rRPArHe+77egmzhZumfNp24ZDNBFhvkxrn52LU8bhXBFa85K+39USjVxKn7YtQ98eneaHG3GAcMqukQ2ZoCHZOICBEnyPZQX1anEZ3EKY1MFmpSMqINqrijmzTscLVcD6BrHEpDdkcs4Z3QTlImsgORd3gB15lbTMdpeUg7Hr2OK5uU7yRZSTtlFVR1aXRjLQOB2h1YjAvAd5S+W1sPqwHfTy7OxF11cnHmR7Ssiuyma3/odC2kl3yiAwhNo67+x70ahzDHrvlnA4BotyXrjUC5Yp8++asmWJ0nT3XjGG7KqKBgy/IW2XmlptAU1237QP53Ix6+ESAhwvVnauHtJHkblxVUL42xzFEphWO3tgfB1mlBJ4ZERMmXkdPGalK5JyoCHPhv5a5nWzJZBkzBs43nr5+Fg43B2sar8EU0fhVtDF5Ruvbi2cvXg43g5Xrw7PUk3Ajoy1dr9MVgEIbPX2xsvAqCV8/HwevBX9mACU1hFjCYT2BdR/iP/xA/eeEtlpPTU/777WgETW61YjIa9Tke8D9l6Wg0usUftyP8H/7DUtH3uyBOyZuAzrKUlKBw4lparLCIQeUmQozL5UPQbUZYgTQ2SuvZzvsPZbNiBhYlYV6XHXgFuj4LAfOQrN3LDGr3kqbV7iyuKlqs67UoFFBe4HV9o+I9jLcu4z/hemrWYQXKHgvsxFywDAOyaRYtYRYmrMJk1XlGWg0LLWiAipO38SyurAZBeZOGfVUsW+xk6SSe1kVQMaZQG41R1LQDO7ikRQGYJfCE2U0Ab6CaySMD1DgsK3/vaPTrh31i2mZwCH5Jqzp/F8DvQm2k6UwNrTOYP4B26D5WHLb9hrDdQNIHk7s7TZX29v/ToBojUiu+e51nJRUmddyC8fcM+MKGQR2OFF6MTG816GlTKkfRGF5iTGJi7Jf8ijcOjUZBRYaoO/PT7Irz50zlOYrTSVai6ZgmvtHLtM/juuR6OONAqgVNojAoImM1I5oAqtJiSLyhxz/Ogmt5VQ7J2mAwYGvFLq7TVNyYGcfOHcapdvjzxETh91leg3kpLqLOusPiaicBx4wbg2aJm0YhmPm+QyvDcl4VzRK4tY4pV2itdog8W2vxNvJwfEjOWn8AtwIEXJSdprA+cRpXOhfIT6feEBThDEU7cMMiokLTBkpwQTLjK6CqH1qUxiQvU1rhiwTIpcdFpCWtjuMZzerKIfKAXvlwEFeZGvKuR54PBl1+cKAOPnh2r+PqiIJxZ4UKfwlOmWpmEe2RMp6mQcL70LheOGjwchmVNCdb5OPJ+3frZyfff25TLN+dgSoYm9DoI4OBFDCLlLRcAny6RT7GVUmTCbmKq3MswAGBDhR+3mkg+BCdQICvSQm9rmiRBgmfDQBhvwkwehuuhlbw2wSaosPmG7LFtkt203UCN5Q6ywDXGywCfi/ALUBts5U7ixrvwWkBBOCCCE42AOfyAnDNMA4WnzqmYXC/T6b8lUAChFan8X/XlMRos0xoEJ6LDih0QdD4Fsx9sN4IpQJKjMJAffiw90boGfp9WBxuFQ1cMHANUZBkKe2RNCOzOqniPAG5JpQwyYUmeoK+RBFT+ejSBXFAUJKGnNGoqFOUs20ZoiM0cWNDh9eYmIXZptvyXYNlQmMyA+AmgLc4Oj54/373zejoePv4g241KwU/ZAvpxpRW+/RqL1KmC5zfNQ3ihJ3MkJiWcEK4pddVb2zxC3SkXbgnchDwrAyTWq9X0ClcasVOATaC6aUcl/1sO5kH9ow3k5IXTTTHPCrodp4zDJSIyUwSw6R22SO2WBcCwDSrwLrHQ+LrIYQe4+k22wcvtR2Afh3s9Mx4hcrB9/tkEqcROc+uyCxIb0hB8yQGg2rE5bqkBbkKmA21haIkD4qS7qVVxyhg4AXmmCg9MBBZh8XfNmxoSrBgVvuxFcBTC4J7CD/OG8GaviyKgzdB9MiavqdpD3m/r348jRO1EKjEQ8ZcwAP+n0ERgwK5tLCQlXJkRCPddmyEmZn46MZzE9kQ6AK8X6avpbEfcficFpSE4LMCkMhVfF6BYi1ISQAeCGRMw6DWFcf9PsG3mo87TYLptKBTgfXMcBh8HjIJQjXVh8wOXPO4WVo6/dwJkdKdwSK/Deo0PGfar5yG8SSmEWEOQOC0QEuawoAIJ1rgmpXHJC/iy6Ciln+Q2BnDRehdfE2jO8J8cNTn3/g+cU8c6YdD3sKLIEi021YB1i9cm+DJKxd5ufRyFGb5jXZ3sjWCafBbRhQAO5VGHdGkJxv7WmXx7cRjV5J3JnaFbOFhCeoqQ2RBdXjlv93+sL/zt7393/lthYoE+wrbNEHns1GdA14I6Fvay8yqG1zPRgHzmGO1uXeRXWeWpXGVFaIONyc163CL3rl1ops0mMVhax2TUHhnZEtSprYaoMmQrAb5eV7VocEfoFWw3KWwoAF7yXbtLlURDMhczFPD82wXHE3Yab46pymJK6/EQzGJi7JCsoyCRPwmNFNxSXgPHMoaWSXbJTDjnNmLRck6WSWHtKQVnHFEEwQJXh810HiwueElJW+yoQMDVwh0n0RNVkRzmkZAkDMmxpT9PCOroPK+QqUO21fkCWnVI0mWXSDTGZ4H6ZTyfvralaXwMI5gxfQN0u8aq57+z2bANu1GfJYjE88HjXqNZcEtHOhuIkEUkVXG91UZKtCUq4pED80HjR3VxmcfWI8gpJ3+6slg9fXZ09NTUMF9f8t/9qc94q165Klj6k+JB3W8rj6uvQmZ0WJK+Qb0SJSlFSnZ+5RRerCvUjfzIwUYG6L5lXem3VwnHjhKjJjxkAdvJe8MTGx3g/BcPZ4vdC0Nqm8okEAvn8HoL2C0ymNGu8hk9xf0BpUpHfPLllnDtWBJNsUFg5+LFizJpp7zptLXMI2rGFaLobLaWBNVsdRYKZQJwFefpoA/srLhgsW7cvHmrLKiNBodFDSenw2kSaYHKHti8IfFkKhLRb0p8jgaksGdsOt38PsSQ+VbYtPg95WSJ6kNphqHMB4BP0IjwaxJUkd2giQZgyIXSVyQM4abk4gEGQEacYoAoAoaRDc7Y/3WxU/okCjnrXcIHJLYRKhkW2Fo9zFw/++D8CKY0n+ywo7RQneBEz5GsjC8isR2svPGxflsyyNS1KluElLQqojpJYhMUI6lCWzKyt/d3/717e7o973j0fvtw6O9/d+l5aNh5WVOiHX4SKABWjq2VDhdYRuxYqHpJE6DJP6Toog4qgvKFrbpKuh6l2UpWM97DLO6xsvZGAd/Qj/ib+jdw8ODQ/WGFpBdTViDg/23e/u7vP5c72UdhHRhtrYU/ZjZ0D92tbcJcG8SrdUq3DWPIfNMnqFvNggr+Nnh7vtigZVZ2hNhzYXO0kB445B04BrczyL69yN0NhfrIKy32EJHgrvkZ1ieAlnkflqHY3xjzXlg288Q28gPffiSiHvx2CQiTGpzTc+0pgCaNzVePgocNwAWBYuh2200y4+lGjMCZg5R6YpM674++QOIk3R1D5BQMd4rymiJLlsJagiA+QkIKESM9r/WKYkyrIcPM3FSCKoOjarHoESOSxKQis7yrAiKG3KVFRdBATpi8yoFQ19NYN3pgr+LYRSB01LzNyxzllkpPHcgVBQj1gFwROEkGd96mnBKSMUb+wO9cMMcMFLwTFfVxtNY2xW98zChQSFmHhgGzpalUFFotkLms7phZAJj4+YhaGis/jRsJDSjCqet0nLWSmILzoM0SlBf0ME3vaSJo93/s3e82HJLLWgUl2GWpmCv12voVL7GkgJx9YC4AjEd/lCSOIL/q35pxCQTpjEbaWBWm1OBwg3LaCtMarZCTaWJc2L2vlpTU0WMOkp+QbBQ5knRcdyNB/2+W/OjHz9L5WMb5TfwAC6H21syEC3gD+9o7/e9/WOvZQEFcZfrKO9kJYV68LLNcx1+pG/xVRBXI1wzl/m4tZgm+WOdCf0BVpWG2+dByd1jgRyDFGhMJxl45SPxxfdbVmv0VHKMosgkmG1GzcKulFlKCd2vbWGa8O+LpmjQRH2VzFHD5sJG/H64vbP724e3o7d7R8e7+6PjvXe7Bx+OzZVC/xnev84Ld/IgvKBVt3kLsAIfrFuRR8ERepbLAPzjFaUFODzuoYV9qBc35eoPqy07/g2jYR3TjC2z7eS+YHMWbI9pX+dymQHfgJZ+2oWcKJTSHPR1PvA3ETGHMYEOlk9G+HHwfKrsP4jpU4Aly9fg89pYtbaH5mLWAe8HGaxijt3wfbmBizhJBCsAv/8l+ADH5ckMnltvzy+8vgSfKbkAt6Me8lOSV5AclvxiLC4UmbbC1itBU8EsvDpbrsvlbq7599ZXvrUedGc9mCjOIYhf67a6z111j5vqwffUg2+pZe+ob8Y+aI8ps6fF95J+GVm03lS+/Q1PEpdJMKGcVC6gkVAHZBQkK/Du6hrqNnUKrYh8zPRA/4JmLyGLjmdH6jMPtI4y9jGXUHoEaPPIIGwugZCNHCAPamz73Rm3omKmUUhLTr7/LDu7O8NIC5wnP/n+s9a3zqLfnX3sKiEot1BjdmnLSE6QNpliTeMykXFjdIUVjlgqgyLizXl7NbytNJFtWWU5rPNOFjH7BlMYl+UjuRylpTWzpY6u2hia4uf59YZCe4gLYUbRM4anXOntUZ8YH85ck8yZDYFTQKnb+Ci1qc31wj9bGDzPSOj+7VsEpLe31rBBGSB0eVIZ0IBt11KiYB2wsXIYUKVTVsVBsV/PUMzETbXEN0aqWQQeD3ZW2MOICj2yNoC4OBKI6EwF0ZN73xXXB7Kfl7RIuHn5VkPnKrawy+dohCISmrl+nys68yIbg4VDGpFAhnZtyqc1RXaXtJUo7bazPVdyO9rzEqGxdkKQEnLH/msX2pw2FtLy5W6XqTesAJzjQvqhx/OJ04heH0w63giYfI/5AirDIoOlnpR+DdKIC2YNacEVqk95Y7lYavRw6HgsiBbeTgwiHGKhbPV6irnWFWtKs759mcXgbjMB62Ng15Isy2GyYMmKoOOScEMT1qTP0WhvYmjbgbVDto7r3EkCX6vzICVrz0saZmkE9jSZRMPtNBJMog4jSAmzstAABIQBEOdgFqfcFANuEe59qa+hqtDwyLRJrQaLGbRvyl6Ca6ndbutHq7K4Jx3ekKy90DCro4wfyKqlTFMGFORH0tHG+8QYoiL9CwBKOxaAp6+URC1U8IYFnQGHLjT9wjTCeeAa5gBgerfWwDznQWq2/WnLnJkUF/TJcZYxg0R7WGAFpaMcR5lStjyipnlIUBKPUxNPVgKkBDoqoGI432oRwTCJ0qZe3UmELSHyEbPn+gEOANhKtMywJJ0foq5PjoDO08gnP3zyes7d0JWz7hqNNXdX407Bcti6hlOsu7yUGsrOBbuszEpa8N185qrLTwveqGkg+flUN2fDF9vsR1YE+wnx+6YyPBDz5AIEfWrQHRqaz9ZHYxqn0xGwvZoRTr9vbPDJ3ySzfob+lDHQSsAt1q6n2C+xqrlQOvu+7y3DpQrDnYgmwY2Ga43jZla0+VWBBo/icj/Y70jepR2EFr6p/YT8sb13DDfw4e7R8fbhsZyPOeZlerO33drTfAQmFNlkMvoK82wF9wVzlk8ZdVoLemmBV6R4QU37OdI6YgHvS1o7oyMvHuA7MOKaJFlWdPDXWZx21p4PBoPewsZPyJr/vNtdavDN5saov+QJfAWCT+2e+f6z0c/drGQhEjW0fCRP9OPH5JGkXRqFmAUXlPlJs8CmFVB8mtYzWgCdZNUOMOKIz/D2Pa9nIGmPKJu9oLyAcB/S1WucCAdJAuJM9bcUzDsPGsBZLGlzNwW+RLv6iW0VrreSnGmPtJ/xuRIamV/ANtXRRSwobfjMVvKuRcbSAGBkFnAbAil75iQoq5HwnJbpBdDcqy4KmlbCvtG2ksIHqe6h2nqNdyVIqCLDq9hnABCWE/5/g4GXkwbbPgl2HHj+bvknM8AC846ECYlFCzD+wT0DS7wf4HK8iNlRwtOCxh/8Qm5KcObaYHFiMHe4grfA5cYyP0iD5OZP2vk8yZKIFmArrm3rXU+3vwvrAr8yPdSMVoEw+tQEX7auh09F2QkJXZT51nMpbKxLhdzeKpmKcc0YJUsLaO7VSjOnX7KZJc1RxEXo6Ewp3w442yQJ7JNmPojxr+ACB3lLw1h1/mY3/doemUoz1yliTWFvNxdUA1PcTBx+HWmcvlwOfDUvXY4WqCwyCMvWlqJBSw3eUB/dawwSuCJ6LVOzaZ9O5/SybssqthxMVnXZo6lOpDWZJi/d9L7ZY25Rl8Jrirn+6P6gSo7P7xcM4k/Ty7gANR4+oKsM4prkQVlStITXHqGtPjckTi+zCyF2/xGJCU0vf9KuLMujS7+w7KKm12uQJNkVDEY46uOowB49mxBMYLL9/v1ob//oeHt/ZxcQD7z9qJTACM+3f1DBh+kZUN4fHuzsHh3J9qN/bh8izdJ85kaXQaFkkleUpJQtD/odohE+BCpsjqUum8OA2XNW6YLelB2LwHI6iqJbTedWZOFe1CQ6Luq8J/X5d12IHwHRKExITTgNi1s8p05dHJcg6y1OtCU+s5+yaizNKc0fiAFWgSmzotLgBD0ybsIZk1USyDabfOsiOgnALa7K2I5lKSVPyZq9Rfv1bIxKTz5XuXUngzPbr5n8TAZkaFZ5ynnKfp+M6wqlqQJZAuwzuAziRHDOMkJWjE9hEpMfFTge9WaTxE+fGkIzVUPIcmOWpGJ1TTcnsWcUS6o0LmhwYUm90H/D3M0tC4Y6B/GE1CXLIcXlb3BOevr5kCVcMKX8WbUWhtsDbIuS5y1zUhaflSVPy1Ln5SEnxn1mGuvQdnIWnx05KLZFnQX96EYVC06T8zxBu5OBWDbABHb3BGq/g0TeRGpv8fTBpvJhcs9g1wjRCEQ5crkWS55OC2Uax5N3O7QqPpUPv/ZxMHclR4Hj1Sd9Dvhr8c4IlgLxA+xYaSqznx4v7fXLKNx4Tp+tBxthsDaJxs+il69frb/eePaCvorG4YvXG5O18dqrQfDyxbPw9evJ+mA9GIcbG+uvJhtr66//8vHS+IhnEI+MLVFMS3Kw//Zf5MPR7huyt09Wf3qzvfvuYP/HVdkQo3WhZy6xInXhR0c6Rnc0LxVIa4kgWldBRYsJuAY0AmjJIlm5ruKkARk+qhpF0uy7LhJHSsfWdI7aWxminZtxuqosS8o+VFnNWZ1VET3djDjWFiaq+RIHh1ohcZnUSWKw9RgejdUT7xZDtaie+tawFSiMZdzp+pdBUlNfAiMt2YIURG+/v+252GgNBgtgxUPK6jOREHkby3matWPu3rvXVRGwCEU6BKDBmOGoNK5t+CBCJ4jfffEOAGGYZQvqrMMBNG+Y9uqMN9CiAuuN9Uu2HYIIwMeiYKj2EU1oRd2z8dFZX9Q1/eTfxdeWdNC9IPLWmdeRwcj0OFs1C6qdtx/sXaGluSWPlEnZuuXrpN31tCzt5zqaOYw/NSID2PA2hTCJDX/8ydcTKfE+svGnBmrpIwd/ljgNmBcwo75dfRKcIN/eShMP9uGR2nVpLqzB0gz+dCzgHTT9glN6NbqgNwaLgAYd2OCEF59htyesXw74zAwwrI1BtdoiFhyX+adzEmLhQHnKc7/xNQQOPCqynCAFYY9UD25qTy30u/j637nWD1xp1zpjDk6YTPNAulZYrqeZg2K5zdBeUwt3An5encfhOYTR2r2OS7QjUDdFnEBSVJP3n9iW5qKWD4lQO0ZjbVks++9JiYI7NFbBmgqHnNnlnMHLpanmBO8mLZ4vr64JeO5slaeGjpIh0SefjT+ZdwLQEGFdd3tLxN9awAQOWqZwE10xggMAtU6tgIZ61+PapH0g2AQpyNuD30dvto93R78dHL7bPobbiaN2Ww3Nbsy0xhChjLXUbCw1ilxSmTdOVOh0m/sh83+pq1dmAmsZU/du+NHlWQq4dR6EF2j75UHgQYh8AKEDWK4q9EjwroIi9c56Qo4b6YZefGolWOCJCirPuC+qYCfNk8wUP/ocRR8nrAg9Jtgn8cVt997SwYUDNotJrRiahmfR2IqgDv/M/DLv36278j0Io5TFCRo8hNCsZMTQb6tkpJUxc6DxlWk0WiaTC1HZXID35ijlQwiDGwxUickpa3jplY3ke9qWaH/qf4CQiXkMC39U8Q4GOQotrHwhqi+QG0G4DOPDln5GYDD4YpMROIb4q97CHJlEs4szPkH+RZ+j7p/iDKQhVlqPLK7TFB5knEeEcPrNH6E2GiLPZHU1zQAAd7MoZR2hH9W7UYXKJp33o4q0rOvKB6vfJ+9AaV2CfjSKCxpWWQHvyGxCPkJMlI9oTvoxj6PyI9jUlJUvW2o3Sr+PIVMwigrmmY1KV7iUtKvXNzX4qRZfAv6pVkzWb7Yk5NEE8qLDjYl3mEwSBDfb7CKKC/W5R7zBy+fPPauHu66Zs1rQy8ODAwhMcfy3Hkm7Rps77S95TWrXM1YSgg6+Ax0tFyo88NFNHg2ijAWHtD9lHxauO8RALkXh883Xx6BHbJFvZ19jDpLsSjPeZft0k7MdxdzAPVKeYyrWMSUg1aIRcIEfywoicoks0N2PPfIxqyv4QYvio9YDg2aKHDFfgSkj61z3yE3XfiKsXvvheVCA2fV21RnAYb0xv+jcgpzBDlsvljGJpckW14kSyrFF/eOoE2ddjRnsxJl4kj3aImuOO7SFp4kzkOpmTISnXW97E1ytjyyOwRFL2s0SuMKJwLB0WMHXGoXZLA+qGAgcstYf89k6Ue5fH7XxStvzqDyJszM7TQ03bxLF/iTqOuYkFwO3CxOThrQz6JE1d9Z6xBuWTV1jra8rO74RhsTakoOzHZzjCasRsuDbJdk9PARvGpmhk4dm4rJ+fg544vMyTkNKzimrAtopLWoTEa8KhH97ywRi0kB7/8Pbt16X/ERW15qFsndew+WUxOQnjbRfbAeApvAVBRRke45sc498niTBtBwSL/DuDMCWLyeuplXe8bKcpkY0A4tZkNtsu1sZYI1hG82gj4WBKNi/hiup7Zt81+xHrppVqzGOEUcc45GgVV0ebe+6LYWsWBLFDqK0duMajy5lLi90tMxUEWWuPO4+8l9w/bHBlSSugFSGQZqlcTjk7VfxBmWx67DFOACtMOpsyypIkoBbHLEI9b5sdog7yhr+Hlfn9ZgLl3tiAEJKB2OYxhUZFwGEjpwU2YxkRTwFIyaiAeWgBRfA3h13HNpIpkyWzECp6uywSRlT7wClylAzF88gWzdabosJ/EKvgxmEOd5OroKbUi4SxBtfLZMgvPBQZxeneV2VxJsFq38GSV+V9prfvsuu0lU2S87rPlGIpQCvrvkDf+BX0z89IC6q4Bcs8PgQkceZ0orP7R1ObR9Ce6ijoK2N8eITacJUMVM7ybecIBvK6gLF4qyrkd5uS4ei32qHfMVslMP9DQjMj3D5M9+QrMDKxt7DcOMKLiPgLAKQ38QRyS+mXcWp7cEeDMkxmCkYAKk/9cFFKsugt9OVHvtDLbD4BKYYfVmtKyEf1JUErc1Bezo3V8SfIePUPz0FaB2IYvdzt9+1RDhzGv5Xx396etrv/tw5+a/T0/7Z0247KNKyJ18C/mT9TKNxSwy2q8L2Wb90Vk+C1T+3V//vYPX1SPve/fn7vp1E90ETeWDXJ2v6FG3fXI0LBT6GEzqgUU/Pqyovh/3+FCmaH2azPoSW7rPhCbxwLpi8rwEOd7Yy1PTLLwBPxN73uiyhui2TNsf9NcYMMFxjZgorsFmoi8THO8YFSN2E7knWRezDY+UBs4ObZ9jv98+zGW3Oi1uhzZ8cB+F1rdje99kSGcLy9LT/fb9HPK97z4nA2AHU/cffd+1M27mF5wh7nLBQgr+crnQfRE7U7PTTNP8I/QIy3DLMcjHLX9b9NX+wOqYinW7LXJnWns/3F2R0H7ZPZT0uq6Iz6C3qha3Mgj1jjb+DWfGLfbnj9N1XOf/feZoFhhxh28bLzv0p5HP6kv4FsjNQiOz2KKSYoNHaYFStNMa6kk5XIQsVnLAdZQ8iYYzOPqlnkPn9lP/z4X/7H956xgD0FBhDV5wt9DXXRQ4oSKbXb+JpjCrx05XB2vrGs+cvXr56HYzDiE5OV3hVl1HXxgvTjIuQ8iSGR5iEKXDUdkMpgjTKZp0ueUIG12uDLrwMTBPR8mTt2RkO6ZkcQ3my9toJvsNKHpPB9UaX3JLB9SsNYnnyCpU/J2sb/Cf/e32D9bAqe+CbU/qfsjjtnK6crmj+EC3pAc2kQ5bxyyQIN+j42fON9VcvB89fj18/e/ZiLZxMnj1/vT54Ha5Hg+BluDYYh+PXz+h4Mpi8ehEE0ato8Orl5NX65NVf2fjFq0uUGMRh5ZmeI/jE1JeNJPGF9LVkHnnwtkIHdd/3CaSPgQjkPMw+To5sJ/Q6SKOCgmjnT5rQqzj8k/wYlL/U4E8dnvtx9hO38uXL8v7dumlgs0Q6vOWy8kG2Gpl9rmk9I4tlg6yt60zrmph1uIn3ovx4bdY9+cV0Xhv+4PCZBY1oE0c1hg9qzJ4XOMyByByToOWSBuq4sUT2QDN9oEK0N5Sla+DZ+LR8DGgEZMWC4cnlLA+lht2QJOuQQIwbdUsZhdmjrgaY0uodQ+g3AecQjEA0mATCUg2MTSmA9ljmkeQ1iLoNulliWaArbxg0pFdh6X9DzRGN3osiyeZxRCiVuTktpWUp/vg1EM3cVqxgQ9IjsfFOUqmdp7TirfciqNkMDJWjaxXny7ra03wfo9uXPVGRzvLqBnQuVVxWcahFkodqpslP0+VFD7PMZmlPwphBXmQnHpIpjMBvvAFndJYVNzL/oPgX5jV8015shqhOGeio2dqpjcTJ67CJaw5Q1fs4+oBF6LSgVsHUaP+9LlFgC6bNXpKAs2HLummR+VpD2fEoGGFQw5V0dY5S5YB5ChlEwt3c8KX6gr2Yvxut++HYEV1v6N4TbVcM2Tx3PnWsemPRjmQtIRDithGPvO7/kNXQScySw4YFtAkKq9RMKvAtpumeqClfWYqAbZq1ACdQGSM2/SQ3Q5NruPMfNMHF9G2Ic/LZHzahGzL3c3QaxRz3kPkY/MoHXdIna0sQQbfVSPMw2OHlGkls2u/lqJ7lfO9AZ3PfS9hq3pJJXrtxRwmrZjzCINC+XDnb/LL9etbvZwwDz+K66aLrN1nqVaanWRBWdZDgxJkOMJ5IGxgcXFyy60ACqVOM7oKZ5+g1aHPiiiY3JIojph8FWB+VFBuDx2cTCER/HuQ5TUsWJAleKGERlOcQduMK1Yce1x9q7nASDAxWjRK1sYG44XGgmRy4r+75R7CYYDrSCNeEqUvJmzhCeivXRHXBU5LZwGkpl8RrKsIEMn4u6xAjHzKnf327h8ZfzaQuure7vG21C1s6XF2TuCxrWvJkqbgScvhaA3xOfbfx7NVz/WrSB9HkhNT5wwSEYEAaTyBNpuwAk2ZyID1IVXEjNAkYyWwCmSQAG+o8YhnQdNJmGoGABcebD+/ej37be7uLJhxdzUYPcNnHMJdvoG+UfYg18iz6aNbVoiV8NvSbd9YE2dQE2kP8IthzhpCzLIonjoXFhsZJ4QYaLKyqfmi+DoIYw4b8DeB/XufNkVkmo3iNLlpvax0baWJlk1+3d/7xQWvZg7oQNqBZVYPuVEq4wxMvE5zYXAhIwM5sTDTk5GbC8YSMi+yCpi2L0z5RbYZ/PzrY95kKEVyz9d3RzTIePh9HmGd10EELXtu4N3db7T2yd3fJabdubBN+m8lgy5pwS0I4XheU5nyLGlM0Y/M58MplD7hgoe8cOPQtiHcZXGKYkg6mzTHVF/JSapAHIPkwhoZbCG8hfTKlg+yiiiIQiVz2N9yAE44KI9ila2wagGsu5daGa1weaH5kNVMTgAK/PI8nusWJEK0ai2TJfJtl9+HkcmFgeV+5Cmb/2r2GSIvSGUtxeDwyq7LJsaQpDVSalWBO6uVZOvUewJCyaBD/iJOESSv1sRhljnz1fMRWaDQjaFtzJLXILiwjLDdYZF5DvnEaSxo3P91vlZt96NOLI2PJEWs7GDvT9oHWA1aJfYEqSTbdTiNhy8+sPOMITZBjSDR5kWZXqdftkc/aUwP7sZ2sISHA7S1xfW/kN1o8Bj2G6JRWGPSQB5Mx3KvtoWkRbZqvhbZhaammOO3ALlTUv81moU5N9O8yCbv+2pib0N1MGC9CjiybzN2dSpl5JTZyKY9Q/uWOyDA3VTI2uXeqZDudxT0SJRsQ7pm2uHGUmVl6wCIagh0Y51XHN2TvjXWocVTf8ECb8P8DDvOcGFAqY0hbBOQtR8a/+5xyGfiUx9vioX7kEJfo206b/CXd4+ZAWE53/7y2jKCuAqnep1MRF57Fgocg8ORpMzIrbJoYFuNs7Y1zn9s5dM40oG2jA+4jh3WdB80+almupSSABzCI0WOIwUJYtjqPH0OvcfKy/MsOnkoEbp44De6CAycCwUS20boXRx6cRG2rkTTHka+R+q97ZofLnFoiMyg3T664f1AMgC5Gq2ANK/NJByV3rzFSZ7TGXzQZgKXjtTWCfzXiD7vfHm75XieOuhZ/jB57mAcRnGQhCASZ0QDtUpvpt1HEhVSG3NDKmg4DI863ACqg2jvYEoyyiXQC0zYhrOT684FaSDPmsgjPGeS5TN7nWRFJWcK+ZoRFZ/TMZgh5RSebgfoMgqYZDZkamiDPt3BwWz9EKr/meXCJjHIc3XfA94p678aUzzwsvAgsKlL7DIkXSkEUZooSiHDVR/2o13y2wuZBVU3LYiyMOZVWn4R7zEk0WRDgWWOweNowH6iV8TviKk96481TsxmbmMOPkoS6zE7QaIfDpmOCuMdL1cStX1BVw0KNI2xfUWeo84dRlIbasjn4e6RXIC5x1v3SLBBbdOSS2nxphoxWGPfKkuHawC8l8CZHz3Kvl7R6R6vgP4mH/g9+EM/p3Qxr33Cn3lwMYF4A/XntjNDMeg6C5VBE6fhcAiQm/NMfeZJ33KtY3GxMpwDOUOgbBV5M8Be6raByLagCcIKy5T0I+luwqBbkORitau8UWGrudJPtmMvyOx7sbfgH1fRXEbJdj0hVBGkJvvUgny8hgCdjmkUlLhqZx5+yYcwLAKiUckZAIrww6XU1WkBnjLCxdhAPFWu1gUqHnE9WuCSlBVaiGVDrMp4y5hgG12hemw8ffqdyEBivBv2nkxvGnHCETGgFU1PB3SsLD3nBt0BEG7SOiRCPqWEvh0uPkZqkNAzNPjGdqAyCdXurXxNaZgxgNK1IfvehibxjttoymK09CY/H59If9F/hVvBgk6KxQoKHi1jUAcbrDYygzLjrOjFuOf56HIZ3tAAPOXoFTwmUH6N/uYjBj3+hZZyePecJi6hU3pQVncHaMO9uhQv4mM8m1aH5XTTnERnM4F9W8grgmLXpmHW1CGt6WDUDb+amOFlq104OLfR4WPoT6w3a/iJ2SMja88m1iLTUBBcT+YZE1rlkOkf671+0Bj/fnqvBkHOZY5DPaskS628lR2wEZ8xwYQTDh3Amz7OSFPSIlnipaeqycGR3bdIyecNoT9PxjXJAbaP5+1oFSeJT18cH0f195hek4ijgE36BpTREdvz1Bpp2hD+geTRYZS5cYUaPzkiDS6DjB0ZnBSSb3kqvAtUvS9e8c7C/8+HwcHf/eLS9c7x3sH+knR1GcjAcgckhLThAevwF7+QPeKp9UUalexKT5khcF3nncxwNm4/ZOxV/gYGQMf1d/T9aMuNmM8Wo0bxVYj/vRDmkCI6hu3dFCwCl7ZA45oDsP5Rqt4SWqMzIHrnK0tNTr9KYMQhZAfgtD3cr+b0nd91uQrfY0rGpFpjH2B5BvER+z/O8uJVm9BVZtKekaXSE1Y6zdqYT7urF5Ge+bszV0T1YUGGLYbCifIK8CvvrGwnsv5gDZGnepYIUt4kNH3RE7Ff2nlEaU9bSEDMJAQzQHbdCSJdnmhnYXcET7yedgGHjOWIj7/CffGW6pnLNDNn7Be9+N05rFyttu1odWOe8X5dC8MUYbV+uTpyec7kamK573mvIjjqhNnz/tncxrvA3vpCX1UQvyNs8h812yG2NQ9XUCpinqO0k2TdTq0GeUVVTNEGrHlkfDL769WMKd77gCnLZX2Q5xDUKz1luJDprWHfBpYsXc+OEsQqNzxjlt/F1ks4/jqIX/QCyDnoMYo9MUuMkMkmGEa4WFpYPm0XUyfJt7pOufWbP9G2M2WUE07DPdquLoUXOqSMiaG4niHClvuB56+UpuBIrYISNY22xzI/iEsS6ThGEwWzcyceUjnVsFZR2REliHDEJCF9ie+S4HVrUCcWatoDfR8KzfAcWXcX+ukaYC+MkGQHDXYvFGFNrrVjWifkrrwJqaCdvkrpMcOdYXhxn0ym4g8w9ZhVWch20IxFry3XcRCIpXZrEE0pBcFEZkZHnim8KILU8UnpcT3UytYF9zbPZEAVqezgH7Xxl+STxrh0sR7wFgOeimxHaw0Q1F/48anzctHDVLO268Jam7WhrvqWWwnU7LsgSCNy00TMwU7fI+w9EWTWu/8VYA2MXoeBcBAFnqoqPlkYKZ0Tz5fC339cHoB8dI2Of62zpEd+/DKXbbdlV3NRv8YxW0Oe+MwzbIybTh3sDIpbq4iiNZdmLFiW1M/KssxYNpoV0DPMijNrBQCx4Hc8dskzRylUxP4DaR9eP8LBJvCdIV8l+daQDYSF7ec1ZFlk+e6Ihvs+bgNAaExxFmEEaL8UPDSc9+5FBiA680whxCmqzIQZtZ5u8IGJ5ywuk6SEkLKZsHyHThclYn9+y4sJaHMmhiUmMFCraoQCbNTqtWgyiv2bmvWHMkc97WzUFZsqarP2Ogg1/C2re44wcVVHceMXQNILy48woZeeYnRuMX0ktf2p2k/Gg+kIwqUzTjUqoZmajAJU7DEkT3pWqX0MIoY1KJwpsMC1msLyUm+sRK+EamLbwCjCke5ld4zyzgs1lEtMkIrO4ZMlyHYKzGdPw68PRiBNbEFkMfy4jd2OPoqYV5INNuffekB/RlBuH+5R4PwmZl++yFzIVo3NIxj3GsxOkoLVCpEg4hqjnZpxKQssgLxiUFNs7JCutIv4vtslftKbZZAJTa6xpQwLq41lg3p0dpsZz5Yx3EACdirCeh6RpuIgLPMQfGp1x+aU8SKRKm3LSO5sgCQ4h48yui7Z8nihGduygDBAKqUXcvhR1cJIGtSBmZbCsmltdkJQqy+N7HcW9Nz3yZvt4G8jK8cH7vR1OV+LyHqTFoCuYPUSVwZ9/Obrylz/CaEKCG2BpDL7KkWphAAREweUzs3LxleEFkAR12ub4ngEtfsfZqyqTtzuaJQKyOjQSs3L63vQ4VS+B2YNtuxRUIxrLrGkyK5xdwpnNqONhCWeRr3lSL6VD+0ItmhrBElo0HjsG5zdC3ylN5Gagl8MquiljZQUNsxr22efd8MzAuDazcmqxr9ZYjDcoEbHUwU8qw2jkZFxPJrRoQvB5uWG5rTO3pg2B2a0rUNQSh5nFHERPD6YKZ+DgSPPJ4q7B80s5sml+AdYezjNb/0aqnP4TbSX5ieQPHr2gb73yZpEPb2YiMrZB6hL4WNexaT+lKJXYfV38a0jSrMr669Tl1iLUfGFWp5DZeK0naBL3dSHmyrq6vJ+7GSfNDSUt+0U+8DzU8jVphLbUT8g2UwaWGKYU+FLh9wxBg1mYVX6EexifSWvKrLRxo8qppcglMyHiJmwYql1fJwAiuvEs8mVQYlEWFMViSYaqXrIk5QNtu5Q4g153AofZXVAULI28zPf3yK62gPUkjf2HcVjOMyY+zHv/qj8kJWdjbMZbe4grg0XxIJujFepCmzBfs3kDhLmP3IJJrVtj7BjdlcQlI1nbl0GcYEa2LQnMpPRxGnEaSbZ+Ik6CrlH0R3qqxmbYpECjk5JKTjDhBeRZynOjAbA6yB5h1hXIuJSllpjJMY+WYH8PW2yzt07ug8sDTLsjVyufjfBlyiJ1AyrDquj8ukRTSe+XrFbmQTinroDkYWZtK48xIWqI8++MthEsuD2swF+kBX+W4BTIA7gFsgTHYKUjbGQ2ar3+xUXamI3uY2GPpw3B5qCYdaLdd2rXBOY65233avNmnd/eXiAgpU+fbn7pMdIH8+WH0qpjqYm7egvzTl6Cj5OqB4wOze0eM7wI8KVsXvlLWBHOjen8Ty2B+9eNO6SAz4s+JGxzgLQex+FFxyX6aTgKXUxF5vk5HojK9VGyADyqdIfbpdoeiG4RgfNGNU01HI9uLRmjtLyCNp6WQmw+UH90If03zSBILhbU5C96pjxMLo9anTr9H7c++jH88gWa0uqQQtB0HX2DYtqwASxELSUSma2PREq1oY6tkidMs4hqVbz9/rZnFmLYfhm7DVSjJ97Iw8X2gEfH9AWqTVBMLwdaffzbKLUKZRlGRTU68j8c7R6qclwljGW3dzT6Y2//zcEfR4rF0YwTYckoPLrIz/anTrcxy+n94E6bcKdOuMCKGtORJbMgDabgRgvRaodzXxX8lpVNuZobPHCHyqgAP3D64zLdFNuuW3DKbz5ss0HkAI18AzO23K3sq+VBRJT156CfbCpaTFdXPGsEy6fa5j9guj9Y8ea0G4tNwwYGPE+WV9ryuYqMGBiMG4ekpfNqd0ljURrOR3xMvJgT3jtjXRoxsxlUFVQbxxBHX212GlR3zc3myLH/O8j7cnbXW6FpVdysDFe+e0T6dVn0x3Haz2+q8yzdOE2/I7vbR/9a3ds/Ot5++3Z1d//48F+rRzuHe++Ph8S7ouMyCy/iyc3W1sBfg+SHPY9rp0eMvyi9nlbNO03jGRJGSHvCfy1vShjed/jeEplqWVYMFhE4KG9GPKPTJikpJd+tr71+dZqORoIfGo3IlnM4ALgqbli2TOYjznpN4rE/o1WA8mA+kCiG4KjjmjFF9DqkeUX2sAwvJQ5FwWvCHM2HiaSoDa6Ell9MwScf89eUAhAo2ke4V6M8i9OKPQIjOtE6t+t0ypyGPTItsjrnji+8LxjWiHmGjXoEVg+qQoK4KkYa4W1tCeUlSmzQ4LWjscz6SOTos0IvAFmRPv+O7LXra9XMFLtagY8Dh+cG+wVcWPVi/cHKYHQNaoJG2nz0XR8Wh8XdO02nSTYOkrLT9UtaRXQS1EnV8ezlAxuU1rXlkOIJGeGUAAW3iDcazYI4HY08vtDlDbtZWaL4AhOcdQqvs8qOx+mpn99c/Xx7egpa5O7P32O2rp7erKsAQWCZTmOTnceQNM+hfkC8bgfE+yt3/w+eREw+',
        'base64',
      ),
    ).toString(),
  );
  const data = new Map();
  const dirs = new Set(['/']);
  const links = new Map([
    ['/bin', '/usr/bin'],
    ['/bin/sh', '/usr/bin/dash'],
    ['/usr/bin/python3', '/usr/bin/python3.10'],
  ]);
  const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
  const add = (p, v = 'binary') => {
    data.set(p, Buffer.from(v));
    let d = parent(p);
    for (;;) {
      dirs.add(d);
      if (d === '/') break;
      d = parent(d);
    }
  };
  for (const p of [
    '/usr/bin/unshare',
    '/usr/bin/dash',
    '/usr/bin/mount',
    '/usr/bin/setpriv',
    '/usr/bin/python3.10',
    '/usr/bin/Xvfb',
    '/usr/bin/bash',
    '/usr/bin/x11vnc',
    '/usr/bin/pkill',
    '/usr/bin/sleep',
    '/usr/bin/date',
    '/opt/brave.com/brave/brave',
    '/opt/brave.com/brave/chrome_crashpad_handler',
    '/opt/holaday-vnc/start.sh',
    '/usr/lib/python3.10/site.py',
    '/usr/lib/python3.10/importlib/metadata/__init__.py',
  ])
    add(p);
  add('/usr/bin/websockify', entry);
  add('/usr/lib/node_modules/pm2/package.json', '{"version":"6.0.14"}');
  for (const f of publicSources.files) add(`/usr/lib/node_modules/pm2/${f.path}`, f.source);
  for (const n of [
    '__init__',
    'websocket',
    'websocketserver',
    'websocketproxy',
    'websockifyserver',
  ])
    add(`/usr/lib/python3/dist-packages/websockify/${n}.py`, '# synthetic module\n');
  add(
    '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/PKG-INFO',
    'Name: websockify\nVersion: 0.10.0\n',
  );
  add(
    '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/entry_points.txt',
    '[console_scripts]\nwebsockify = websockify.websocketproxy:websockify_init\n',
  );
  add('/root/.pm2/pm2.pid', '40\n');
  add('/proc/sys/kernel/random/boot_id', '11111111-1111-4111-8111-111111111111\n');
  add('/proc/40/stat', `40 (PM2 daemon) S 1 ${Array(17).fill('0').join(' ')} 1234\n`);
  add('/proc/40/cmdline', 'PM2 v6.0.14: God Daemon (/root/.pm2)\0');
  add('/proc/40/status', 'Uid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n');
  add('/proc/40/environ', 'PRIVATE_DAEMON=never-export-this\0');
  const missing = () => Object.assign(new Error('synthetic missing'), { code: 'ENOENT' });
  const resolve = (p) =>
    links.get(p) ?? (p.startsWith('/bin/') ? p.replace('/bin/', '/usr/bin/') : p);
  const modes = new Map();
  const getStat = (p) => {
    const type = links.has(p) ? 'link' : dirs.has(p) ? 'dir' : data.has(p) ? 'file' : null;
    if (!type) throw missing();
    return {
      dev: 1,
      ino: p,
      mode: modes.get(p) ?? (type === 'link' ? 0o120777 : type === 'dir' ? 0o40755 : 0o100755),
      uid: 0,
      gid: 0,
      size: data.get(p)?.length ?? 0,
      mtimeMs: 1,
      ctimeMs: 1,
      isFile: () => type === 'file',
      isDirectory: () => type === 'dir',
      isSymbolicLink: () => type === 'link',
    };
  };
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    monotonic: () => 1,
    hostname: () => 'qa-vultr',
    lstat: async (p) => getStat(p),
    realpath: async (p) => {
      const r = resolve(p);
      getStat(r);
      return r;
    },
    readdir: async (p) => {
      getStat(p);
      return [
        ...new Set(
          [...data.keys(), ...dirs, ...links.keys()]
            .filter((q) => q !== p && parent(q) === p)
            .map((q) => q.slice(p.length + (p === '/' ? 0 : 1))),
        ),
      ];
    },
    opendir: async function (p) {
      const names = await this.readdir(p);
      let index = 0;
      return {
        read: async () => (index < names.length ? { name: names[index++] } : null),
        close: async () => {},
      };
    },
    open: async (p) => {
      getStat(p);
      let offset = 0;
      return {
        stat: async () => getStat(p),
        read: async (buf, start, length) => {
          const bytes = data.get(p);
          const n = Math.min(length, bytes.length - offset);
          bytes.copy(buf, start, offset, offset + n);
          offset += n;
          return { bytesRead: n };
        },
        close: async () => {},
      };
    },
  };
  const configs = ['holaday-vnc', 'holaday-chromium-headed'].map((name, i) => ({
    name,
    pmId: 6 + i,
    config: {
      name,
      pm_id: 6 + i,
      status: 'online',
      restart_time: 3,
      exec_mode: 'fork_mode',
      autostart: true,
      pm_exec_path: i ? '/opt/holaday-headed/start.sh' : '/opt/holaday-vnc/start.sh',
      exec_interpreter: 'bash',
      args: [],
      pm_cwd: '/root',
      env: { PATH: '/usr/bin', HOME: '/root', DISPLAY: ':98', PRIVATE_VALUE: 'never-export-this' },
    },
  }));
  return {
    input: { attempt: '22222222-2222-4222-8222-222222222222', configs },
    io,
    data,
    dirs,
    links,
    modes,
    add,
  };
}
for (const mode of ['missing', 'top-level', 'nested-overrides']) {
  test(`cloud sources VNC display accepts ${mode} without changing retained config`, async () => {
    const f = await sourceNativeFixture();
    const baseline = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
    const config = f.input.configs[0].config;
    if (mode === 'missing' || mode === 'top-level') Reflect.deleteProperty(config.env, 'DISPLAY');
    if (mode === 'top-level') config.DISPLAY = ':98';
    if (mode === 'nested-overrides') config.DISPLAY = ':0';
    const retained = structuredClone(f.input);
    const observed = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
    assert.deepEqual(f.input, retained);
    assert.equal(observed.roles[0].configDigest, cutoverRegistrationConfigDigest(config));
    assert.equal(observed.roles[1].selectionDigest, baseline.roles[1].selectionDigest);
    if (mode === 'missing') {
      assert.notEqual(observed.roles[0].selectionDigest, baseline.roles[0].selectionDigest);
      assert.equal(Object.hasOwn(config, 'DISPLAY'), false);
      assert.equal(Object.hasOwn(config.env, 'DISPLAY'), false);
    } else {
      assert.equal(observed.roles[0].selectionDigest, baseline.roles[0].selectionDigest);
    }
  });
}
for (const location of ['top-level', 'nested']) {
  for (const value of [':0', '', null, 98, ':98\0']) {
    test(`cloud sources VNC display refuses ${location} ${JSON.stringify(value)}`, async () => {
      const f = await sourceNativeFixture();
      const config = f.input.configs[0].config;
      if (location === 'top-level') {
        Reflect.deleteProperty(config.env, 'DISPLAY');
        config.DISPLAY = value;
      } else {
        config.DISPLAY = ':98';
        config.env.DISPLAY = value;
      }
      await assert.rejects(
        firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
        /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
      );
    });
  }
}
async function recoveryContextFixture() {
  const f = await sourceNativeFixture();
  f.add('/proc/40/stat', `40 (PM2 daemon) S 1 ${Array(17).fill('0').join(' ')} 50\n`);
  f.add(
    '/proc/40/status',
    'Uid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\nCapEff:\t0000000000200100\nCapPrm:\t0000000000200100\nCapBnd:\t0000000000200100\nCapInh:\t0000000000000000\nCapAmb:\t0000000000000000\nNoNewPrivs:\t0\nSeccomp:\t0\n',
  );
  f.add('/proc/40/attr/current', 'unconfined\n');
  f.add('/proc/stat', 'btime 0\n');
  const auxv = Buffer.alloc(32);
  auxv.writeBigUInt64LE(17n, 0);
  auxv.writeBigUInt64LE(100n, 8);
  f.add('/proc/self/auxv', auxv);
  f.add('/opt/node22/bin/node', 'synthetic node');
  const namespaces = new Map();
  for (const pid of [1, 40])
    for (const ns of ['mnt', 'user', 'net']) namespaces.set(`/proc/${pid}/ns/${ns}`, `${ns}:[10]`);
  namespaces.set('/proc/40/exe', '/opt/node22/bin/node');
  f.io.readlink = async (p) => {
    assert.ok(namespaces.has(p), p);
    return namespaces.get(p);
  };
  f.io.stat = (p) => f.io.lstat(p === '/proc/40/exe' ? '/opt/node22/bin/node' : p);
  f.io.arch = 'arm64';
  const sources = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  return { ...f, sources, namespaces };
}
async function ownedDisplayFixture() {
  const f = await recoveryContextFixture();
  const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const exe = new Map([
    [40, '/opt/node22/bin/node'],
    [41, '/usr/bin/bash'],
    [42, '/usr/bin/bash'],
    [43, '/usr/bin/Xvfb'],
    [44, '/usr/bin/openbox'],
    [45, '/usr/bin/x11vnc'],
    [46, '/opt/brave.com/brave/brave'],
    [99, '/usr/bin/other'],
  ]);
  f.add('/usr/bin/openbox', 'window manager');
  const displayCmd = `${['Xvfb', ':98', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'].join('\0')}\0`;
  const census = {
    hostname: f.sources.hostname,
    bootId: f.sources.bootId,
    observedAtMs: 1000,
    processes: [...exe].map(([pid, path]) => ({
      pid,
      ppid: pid === 40 || pid === 99 ? 1 : pid === 41 || pid === 42 ? 40 : pid === 45 ? 41 : 42,
      start: pid === 40 ? '50' : String(pid * 10),
      uids: [0, 0, 0, 0],
      exe: path,
      cwd: '/root',
      argvDigest: sha(pid === 43 ? displayCmd : `synthetic-${pid}`),
      cgroup: '0::/qa',
      mountNamespace: 'mnt:[10]',
      state: 'live',
      noNewPrivs: 0,
      capabilities: Object.fromEntries(
        ['CapEff', 'CapPrm', 'CapBnd', 'CapInh', 'CapAmb'].map((k) => [k, '0000000000000000']),
      ),
    })),
  };
  const rows = f.input.configs.map((c, i) => ({
    name: c.name,
    pm_id: c.pmId,
    pid: 41 + i,
    pm2_env: structuredClone(c.config),
  }));
  f.io.rpc = async (method) => {
    assert.equal(method, 'getMonitorData');
    return structuredClone(rows);
  };
  f.io.readCensus = async () => structuredClone(census);
  for (const p of census.processes) {
    f.namespaces.set(`/proc/${p.pid}/exe`, p.exe);
    for (const ns of ['mnt', 'net', 'user'])
      f.namespaces.set(`/proc/${p.pid}/ns/${ns}`, `${ns}:[10]`);
    if (p.pid !== 40)
      f.add(
        `/proc/${p.pid}/stat`,
        `${p.pid} (qa) S ${p.ppid} ${Array(17).fill('0').join(' ')} ${p.start}\n`,
      );
  }
  f.add('/proc/43/cmdline', displayCmd);
  f.io.stat = (p) => f.io.lstat(f.namespaces.get(p) ?? p);
  const connections = [
    { pid: 45, fd: 8, inode: '202', server: '102', serverFd: 7 },
    { pid: 46, fd: 8, inode: '203', server: '103', serverFd: 8 },
    { pid: 44, fd: 8, inode: '204', server: '104', serverFd: 9 },
  ];
  const sockets = () => {
    f.namespaces.set('/proc/43/fd/5', 'socket:[100]');
    f.namespaces.set('/proc/43/fd/6', 'socket:[101]');
    const lines = [
      'u_str LISTEN 0 128 /tmp/.X11-unix/X98 100 * 0 users:(("Xvfb",pid=43,fd=5))',
      'u_str LISTEN 0 128 @/tmp/.X11-unix/X98 101 * 0 users:(("Xvfb",pid=43,fd=6))',
    ];
    for (const c of connections) {
      f.namespaces.set(`/proc/43/fd/${c.serverFd}`, `socket:[${c.server}]`);
      f.namespaces.set(`/proc/${c.pid}/fd/${c.fd}`, `socket:[${c.inode}]`);
      lines.push(
        `u_str ESTAB 0 0 /tmp/.X11-unix/X98 ${c.server} * ${c.inode} users:(("Xvfb",pid=43,fd=${c.serverFd}))`,
        `u_str ESTAB 0 0 * ${c.inode} * ${c.server} users:(("client",pid=${c.pid},fd=${c.fd}))`,
      );
    }
    return `${lines.join('\n')}\n`;
  };
  let unix = sockets;
  let tcp = '';
  f.io.exec = async (command, args) => {
    assert.equal(command, '/usr/bin/ss');
    if (args.join(' ') === '-H -xapn') return unix();
    assert.equal(args.join(' '), '-H -tanp');
    return tcp;
  };
  return {
    ...f,
    census,
    rows,
    connections,
    sha,
    sockets,
    setUnix: (v) => {
      unix = v;
    },
    setTcp: (v) => {
      tcp = v;
    },
    request: { sources: f.sources, maintenanceEndsAtMs: 15000 },
  };
}
for (const mode of ['success', 'census', 'manager', 'read-close-success', 'read-close-failure'])
  test(`real DISPLAY fixed classification: ${mode}`, async () => {
    async function run(module) {
      const f = await ownedDisplayFixture();
      const calls = [];
      if (mode === 'census')
        f.io.readCensus = async () => {
          throw Object.assign(new Error('PRIVATE'), { code: 'EACCES' });
        };
      if (mode === 'manager')
        f.io.rpc = async () => {
          throw Object.assign(new Error('PRIVATE'), { code: 'EPERM' });
        };
      if (mode.startsWith('read-close')) {
        const open = f.io.open;
        f.io.open = async (...a) => {
          const h = await open(...a);
          return {
            ...h,
            read: async () => {
              calls.push(['read-fail']);
              throw Object.assign(new Error('PRIVATE'), { code: 'EACCES' });
            },
            close: async () => {
              calls.push(['close']);
              if (mode.endsWith('failure'))
                throw Object.assign(new Error('PRIVATE-CLOSE'), { code: 'EBADF' });
              return h.close();
            },
          };
        };
      }
      for (const key of [
        'open',
        'readCensus',
        'rpc',
        'exec',
        'lstat',
        'stat',
        'readlink',
        'realpath',
      ]) {
        const orig = f.io[key];
        if (orig)
          f.io[key] = async (...a) => {
            calls.push([key, ...a]);
            return orig(...a);
          };
      }
      let result;
      let error;
      try {
        result = await module.readFirstCutoverCloudOwnedDisplay(f.request, f.io);
      } catch (e) {
        error = e;
      }
      return { result, error, calls };
    }
    const fresh = await run(firstRuntime);
    if (mode === 'success')
      assert.deepEqual(
        fresh.result.members.map((p) => p.pid),
        [43, 44],
      );
    else assert.equal(fresh.error.message, 'CUTOVER_CLOUD_DISPLAY_SCOPE_UNPROVEN');
    const d = derived.readCutoverCloudObservationDiagnostic(fresh.error);
    if (mode === 'success') assert.equal(d, undefined);
    else {
      assert.ok(d);
      assert.equal(JSON.stringify(d).includes('PRIVATE'), false);
    }
    if (mode === 'read-close-success') {
      assert.match(d.failureStage, /CONTEXT_IO_/);
      assert.equal(d.errno, 'EACCES');
    }
    if (mode === 'read-close-failure') {
      assert.match(d.lastEnteredStage, /CONTEXT_IO_/);
      assert.equal(d.errno, 'EBADF');
    }
  });
import { createFirstCutoverRetirementObserver } from './browser-first-cutover-host.mjs';
for (const sinkThrows of [false, true])
  test(`original observer sink is non-authoritative: ${sinkThrows}`, async () => {
    const events = [];
    const leaf = derived.cutoverCloudObservationError(
      'CUTOVER_CLOUD_DISPLAY_SCOPE_UNPROVEN',
      'DISPLAY_R01',
      { code: 'EACCES' },
    );
    let error;
    try {
      await createFirstCutoverRetirementObserver(
        { reviews: {}, binding: {}, legacyDigest: 'x' },
        {
          now: () => 1000,
          journal: {
            assertOwnership: async () => ({}),
            readFirstCutoverEffects: async () => {
              throw leaf;
            },
          },
          reportRejection: async (e) => {
            events.push(e);
            if (sinkThrows) throw Error('PRIVATE-SINK');
          },
        },
      );
    } catch (e) {
      error = e;
    }
    assert.equal(error.message, 'CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN');
    assert.equal(events[0].code, 'CUTOVER_CLOUD_DISPLAY_SCOPE_UNPROVEN');
    assert.deepEqual(events[0].cloudDiagnostic, { failureStage: 'DISPLAY_R01', errno: 'EACCES' });
    assert.ok(Buffer.byteLength(JSON.stringify(events)) < 65536);
    assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
  });
test('unknown observer event retains original shape', async () => {
  const events = [];
  await assert.rejects(
    createFirstCutoverRetirementObserver(
      {},
      { now: () => Number.NaN, reportRejection: async (e) => events.push(e) },
    ),
    /CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN/,
  );
  assert.deepEqual(Object.keys(events[0]), [
    'schemaVersion',
    'component',
    'operation',
    'step',
    'code',
  ]);
});
