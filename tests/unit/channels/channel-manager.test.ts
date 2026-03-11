import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelManager } from '../../../src/channels/channel-manager.js';
import { IChannelAdapter } from '../../../src/channels/channel-adapter.js';
import { ChannelMessage } from '../../../src/types/channel.js';

describe('ChannelManager', () => {
  let orchestrator: any;
  let gate: any;
  let resolver: any;
  let quarantine: any;
  let audit: any;
  let manager: ChannelManager;
  let mockAdapter: IChannelAdapter;

  beforeEach(() => {
    orchestrator = {
      submitTask: vi.fn().mockResolvedValue('mock response'),
    };
    gate = {
      canIntake: vi.fn().mockResolvedValue(true),
    };
    resolver = {
      resolve: vi.fn().mockResolvedValue({
        role: 'trusted_user',
        allowedTools: ['read_file'],
        actionBudget: 10,
      }),
    };
    quarantine = {
      process: vi.fn().mockResolvedValue({
        goal: 'read test.txt',
        params: {},
        suspicious: false,
      }),
    };
    audit = {
      append: vi.fn().mockResolvedValue(undefined),
    };

    manager = new ChannelManager(orchestrator, gate, resolver, quarantine, audit);

    mockAdapter = {
      name: 'test-adapter',
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('registers an adapter and sets up message handler', async () => {
    await manager.registerAdapter(mockAdapter);
    expect(mockAdapter.onMessage).toHaveBeenCalled();
  });

  it('processes a message through the secure pipeline', async () => {
    await manager.registerAdapter(mockAdapter);
    const messageHandler = (mockAdapter.onMessage as any).mock.calls[0][0];

    const mockMsg: ChannelMessage = {
      id: '123',
      from: { type: 'signal', phoneNumber: '+1234567890', isLinkedDevice: false },
      channelId: 'direct',
      channelType: 'direct',
      content: 'hello',
      timestamp: new Date(),
    };

    await messageHandler(mockMsg);

    expect(gate.canIntake).toHaveBeenCalledWith('+1234567890', 'direct');
    expect(resolver.resolve).toHaveBeenCalledWith('+1234567890', 'direct');
    expect(quarantine.process).toHaveBeenCalledWith(mockMsg, expect.any(Object));
    expect(orchestrator.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'read test.txt',
    }));
    expect(mockAdapter.send).toHaveBeenCalledWith(
      mockMsg.from,
      'direct',
      'mock response',
      expect.any(Object)
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'intake_allowed',
    }));
  });

  it('blocks suspicious messages', async () => {
    quarantine.process.mockResolvedValue({
      goal: 'harmful goal',
      suspicious: true,
      suspicious_reason: 'injection detected',
    });

    await manager.registerAdapter(mockAdapter);
    const messageHandler = (mockAdapter.onMessage as any).mock.calls[0][0];

    const mockMsg: ChannelMessage = {
      id: '123',
      from: { type: 'signal', phoneNumber: '+1234567890', isLinkedDevice: false },
      channelId: 'direct',
      channelType: 'direct',
      content: 'bad content',
      timestamp: new Date(),
    };

    await messageHandler(mockMsg);

    expect(orchestrator.submitTask).not.toHaveBeenCalled();
    expect(mockAdapter.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.stringContaining('Access Denied'),
      expect.any(Object)
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'quarantine_flag',
    }));
  });

  it('silently drops messages from unauthorized senders', async () => {
    gate.canIntake.mockResolvedValue(false);

    await manager.registerAdapter(mockAdapter);
    const messageHandler = (mockAdapter.onMessage as any).mock.calls[0][0];

    const mockMsg: ChannelMessage = {
      id: '123',
      from: { type: 'signal', phoneNumber: '+999', isLinkedDevice: false },
      channelId: 'direct',
      channelType: 'direct',
      content: 'hello',
      timestamp: new Date(),
    };

    await messageHandler(mockMsg);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(mockAdapter.send).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'intake_denied',
      metadata: { reason: 'policy_gate' }
    }));
  });
});
