// The client as a NestJS provider: inject PspClient anywhere by its class.
import { Global, Module } from '@nestjs/common';
import { PspClient } from '@qubiq/psp-sdk';

@Global()
@Module({
  providers: [
    {
      provide: PspClient,
      // With @nestjs/config: inject: [ConfigService], useFactory: (config: ConfigService) => new PspClient({
      //   apiKey: config.getOrThrow('PSP_API_KEY'), apiSecret: config.getOrThrow('PSP_API_SECRET'), … })
      useFactory: () => new PspClient({ userAgent: 'my-shop/1.0' }),
    },
  ],
  exports: [PspClient],
})
export class PspModule {}
