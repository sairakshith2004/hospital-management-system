import { describe, expect, it } from 'vitest';
import { conversationName, type Conversation } from './comm-api';

const base: Conversation = {
  id: 'c1',
  kind: 'direct',
  title: null,
  others: [{ id: 'u2', fullName: 'Asha Rao' }],
  lastMessage: null,
  lastMessageAt: null,
  lastFromMe: null,
  unread: 0,
};

describe('conversationName', () => {
  it('names a direct chat after the other person and a group after its title', () => {
    expect(conversationName(base)).toBe('Asha Rao');
    expect(conversationName({ ...base, kind: 'group', title: 'Ward 3 review' })).toBe(
      'Ward 3 review',
    );
    expect(conversationName({ ...base, others: null })).toBe('Conversation');
  });
});
