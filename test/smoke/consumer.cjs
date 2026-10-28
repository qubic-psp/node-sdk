// The same checks as consumer.mjs, loading the package with require().
'use strict';

const sdk = require('@qubiq/psp-sdk');

import('./consumer.mjs')
  .then(({ run }) => run(sdk, 'cjs'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
