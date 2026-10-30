# Changelog

## [2.0.0-beta.3](https://github.com/rspieker/flugrekorder/compare/v2.0.0-beta.2...v2.0.0-beta.3) (2026-10-30)

### ⚠ BREAKING CHANGES

* getProxyById returns undefined for objects that have been
  garbage collected, and getAncestors returns { id, proxy, origin } steps whose
  proxy is undefined for collected ancestors.
* has and deleteProperty records carry a property origin
  { trap, parent, key } instead of null, and PropertyTrap includes both.
* traps left out of `only` now proxy their results and retry native
  boundaries; only the record is skipped. Use recursive: false to limit how far a proxy reaches.

### Features

* a session no longer keeps alive what it touched ([7076faa](https://github.com/rspieker/flugrekorder/commit/7076faa4dbabc57d5978bfe0978caf857d0ef37b))
* has and deleteProperty records name the key ([30fa28a](https://github.com/rspieker/flugrekorder/commit/30fa28ab0112eea23dfef4895272c2cd2e91a453))
* only selects which traps are recorded, not how they behave ([05bb80d](https://github.com/rspieker/flugrekorder/commit/05bb80d0169d990e4a62df2d31271726daa66ad1))
* values: false records no values, only their kind ([e837bdc](https://github.com/rspieker/flugrekorder/commit/e837bdc16aebaeae0eb1a11e0258b5ba8c067fb4))

### Bug Fixes

* a stream and a callback can no longer be passed together ([6969367](https://github.com/rspieker/flugrekorder/commit/6969367895115d4768c88dd23d6ea6c20e3bec4f))
* an array that contains itself no longer crashes the recorded call ([545ab3d](https://github.com/rspieker/flugrekorder/commit/545ab3dc15e0b68ddfec8e213d8b4710177f3591))
* built-ins behave through a proxy in every engine ([bec7e15](https://github.com/rspieker/flugrekorder/commit/bec7e15ebf8d1158dfcbcb72ef65e4a9b535252b)), references [#private](https://github.com/rspieker/flugrekorder/issues/private) [#private](https://github.com/rspieker/flugrekorder/issues/private)
* methods and getters of URLSearchParams work through a proxy ([12716f8](https://github.com/rspieker/flugrekorder/commit/12716f8427a29bc24d2f5e159a3c16ce1194b043))
* prototype traps no longer get a property origin ([f6e7c9c](https://github.com/rspieker/flugrekorder/commit/f6e7c9c82df8f472b45fd2519cde5976c6905264))

## [2.0.0-beta.2](https://github.com/rspieker/flugrekorder/compare/v2.0.0-beta.1...v2.0.0-beta.2) (2026-10-25)

### ⚠ BREAKING CHANGES

* Raises `engines` to Node.js >= 22.18.

### Features

* record where code lives with `location` and `stack` ([e6b1203](https://github.com/rspieker/flugrekorder/commit/e6b12031b3b907f60043b55ed3f273bbb23ecb17))

## [2.0.0-beta.1](https://github.com/rspieker/flugrekorder/compare/v2.0.0-beta.0...v2.0.0-beta.1) (2026-10-24)

### Features

* wrap a stand-in target so pinned values are proxied and recorded ([1f528e9](https://github.com/rspieker/flugrekorder/commit/1f528e9c2bc806303f186195a63cbd83bb5f897a))

### Bug Fixes

* respect proxy invariants for non-configurable properties ([4b96c9d](https://github.com/rspieker/flugrekorder/commit/4b96c9d070f8ba0540b3acd0a56465a8b8ea6483))

## [2.0.0-beta.0](https://github.com/rspieker/flugrekorder/compare/v1.2.0...v2.0.0-beta.0) (2026-10-22)

### ⚠ BREAKING CHANGES

* the build targets Node.js 22 and dist is ESM-first;
  the CommonJS build moved to `dist/flugrekorder.cjs`. Importing
  `flugrekorder` itself is unaffected.

### Build System

* run TypeScript natively, update dependencies ([d7184d9](https://github.com/rspieker/flugrekorder/commit/d7184d993ad66761fae2d11e08f72c45ad20796f))

## [1.2.0](https://github.com/rspieker/flugrekorder/compare/v1.2.0-beta.0...v1.2.0) (2026-05-27)

## [1.2.0-beta.0](https://github.com/rspieker/flugrekorder/compare/v1.1.0...v1.2.0-beta.0) (2026-05-27)

### Features

* add filter option to configure which rekordings are emitted ([e33287d](https://github.com/rspieker/flugrekorder/commit/e33287db23c62908a5f5170c7b0fc39c3c83a5a5))
* add format() to convert a Rekording to a human-readable string ([0b99182](https://github.com/rspieker/flugrekorder/commit/0b991820ff7f3eef5daef640eac279f00c8f130a))
* add mechanism to retry with bindings on encountering private fields + control option ([f23eacd](https://github.com/rspieker/flugrekorder/commit/f23eacd5fd2d950b119c906b0e3cfbcd47234432))
* add serialization controls ([8fd42a1](https://github.com/rspieker/flugrekorder/commit/8fd42a14fcc66fb1e59449f732355b2b77686a7b))
* add timestamp to every Rekording ([9f0a889](https://github.com/rspieker/flugrekorder/commit/9f0a8896519ebf5f140ced8f37d771c87394b087))
* ensure proxying into structuredClone (et al) does not crash but unwraps ([4a10cc1](https://github.com/rspieker/flugrekorder/commit/4a10cc148a2b7fab807bdf4d2c0f2b016fa127e7))
* export isProxiable type guard ([b7ced8c](https://github.com/rspieker/flugrekorder/commit/b7ced8cdeeb32e436f609d36d34b34c75006b5a7))

### Bug Fixes

* remove the need for definite assignment assertions ('!') ([8b09209](https://github.com/rspieker/flugrekorder/commit/8b09209a0fe60466ec133c1bcd2ef37f50fd5a49))
* wrap http.Server and other C++ bindings without crashing ([61a79ea](https://github.com/rspieker/flugrekorder/commit/61a79ead88e16aec9aa481ed154b46f807592432))

## [1.1.0](https://github.com/rspieker/flugrekorder/compare/v1.1.0-beta.0...v1.1.0) (2026-05-22)

## [1.1.0-beta.0](https://github.com/rspieker/flugrekorder/compare/v1.0.2-beta.1...v1.1.0-beta.0) (2026-05-22)

### Features

* restored simpler release/preview flow ([bbc91af](https://github.com/rspieker/flugrekorder/commit/bbc91af0d28dd39d360f71f9ed78dacd17e7d8b6))

## [1.0.2-beta.1](https://github.com/rspieker/flugrekorder/compare/v1.0.2-beta.0...v1.0.2-beta.1) (2026-05-20)

### Bug Fixes

* add tests for function that fail due to transitioning into native implementations that are required to throw ([aa6b367](https://github.com/rspieker/flugrekorder/commit/aa6b367a00da12b02b5b701966b08ba135821ec9))

## [1.0.2-beta.0](https://github.com/rspieker/flugrekorder/compare/v1.0.1...v1.0.2-beta.0) (2026-05-20)

## [1.0.1](https://github.com/rspieker/flugrekorder/compare/v1.0.0-beta.2...v1.0.1) (2026-05-18)

- 1.0.0 was retracted as the publication of the first beta claimed that version (forgotten `-beta.0` in the version name)

### Features

* initial implementation ([a36bddb](https://github.com/rspieker/flugrekorder/commit/a36bddbafccb9f0e876d057c3827e5ddfc7ff58c))

### Bug Fixes

* trying to publish ([8a1b59c](https://github.com/rspieker/flugrekorder/commit/8a1b59c0d754204d62729ff2ba0a520640eeb969))
* wrapKnown now proxies known targets passed as call arguments ([98213d6](https://github.com/rspieker/flugrekorder/commit/98213d66502bd7492aa1e4361a97f731eae56581))

All notable changes to this project will be documented in this file.
Generated by [release-it](https://github.com/release-it/release-it) from conventional commits.
