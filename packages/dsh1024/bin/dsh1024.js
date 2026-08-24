#!/usr/bin/env node

import { main } from '../cli/index.js'

const exitCode = await main(process.argv.slice(2))
process.exitCode = exitCode
