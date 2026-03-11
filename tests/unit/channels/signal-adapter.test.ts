import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignalAdapter } from '../../../src/channels/signal/signal-adapter.js';
import { SignalIntakeAdapter } from '../../../src/channels/signal/signal-intake-adapter.js';
import { ChannelIdentity, ChannelMessage } from '../../../src/types/channel.js';

describe('SignalAdapter', () => {
  let mockIntake: any;
  let mockCli: any;
  let adapter: SignalAdapter;

  beforeEach(() => {
    mockCli = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockIntake = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn(),
      getCli: vi.fn().mockReturnValue(mockCli),
    };
    adapter = new SignalAdapter(mockIntake as unknown as SignalIntakeAdapter);
  });

  it('starts the intake and initializes gateway', async () => {
    await adapter.start();
    expect(mockIntake.start).toHaveBeenCalled();
    expect(mockIntake.getCli).toHaveBeenCalled();
  });

  it('registers message handler on intake', () => {
    const handler = async (msg: ChannelMessage) => {};
    adapter.onMessage(handler);
    expect(mockIntake.onMessage).toHaveBeenCalledWith(handler);
  });

  it('sends a message through the gateway', async () => {
    await adapter.start();
    const to: ChannelIdentity = {
      type: 'signal',
      phoneNumber: '+1234567890',
      isLinkedDevice: false,
    };
    await adapter.send(to, 'direct', 'hello');
    expect(mockCli.sendMessage).toHaveBeenCalledWith('+1234567890', 'hello', expect.any(Object));
  });

  it('throws error if sending before start', async () => {
    const to: ChannelIdentity = {
      type: 'signal',
      phoneNumber: '+1234567890',
      isLinkedDevice: false,
    };
    await expect(adapter.send(to, 'direct', 'hello')).rejects.toThrow('not started');
  });
});
