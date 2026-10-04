#!/usr/bin/env node
// Creates the git-ignored TEST key pair used by dev builds and automated tests.
import { ensureTestKeys } from './lib/license-lib.mjs';
const k = await ensureTestKeys();
console.log('test keys ready: ' + k.pubPath);
