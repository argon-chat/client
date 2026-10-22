import '../../packages/assets/styles/index.css';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { page, userEvent } from 'vitest/browser';

const state = await vi.hoisted(async () => {
  const { reactive, ref, defineComponent } = await import('vue');
  return {
    ref, grants: reactive(new Map<string, Set<string>>()),
    push: vi.fn(async () => {}), settings: vi.fn(), pin: vi.fn(),
    setVolume: vi.fn(),
    stub: (name: string) => ({ default: defineComponent({ name, props: ['open'], setup: () => () => null }) }),
  };
});
vi.mock('vue-router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/store/system/localeStore', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock('@/store/data/poolStore', () => ({ usePoolStore: () => ({
  selectedServer: 'current-space',
  realtimeChannelUsers: new Map([['voice', { Users: new Map([['bot', { userId: 'bot', volume: [100] }]]) }]]),
}) }));
vi.mock('@/store/data/permissionStore', () => ({ usePexStore: () => ({
  ready: () => true,
  hasInSpace: (id: string, flag: string) => state.grants.get(id)?.has(flag) ?? false,
  has: (flag: string) => state.grants.get('current-space')?.has(flag) ?? false,
}) }));
vi.mock('@/store/ui/windowStore', () => ({ useWindow: () => ({ openServerSettings: state.settings }) }));
vi.mock('@/store/data/notificationStore', () => ({ useNotificationStore: () => ({ isTargetMuted: () => false, muteTarget() {}, unmuteTarget() {} }) }));
vi.mock('@/lib/serverOrganization', () => ({ useServerOrganization: () => ({
  organization: state.ref({ folders: [] }), toggleServerPin: state.pin, isServerPinned: () => false,
  addServerToFolder() {}, removeServerFromFolder() {}, getServerFolder: () => null,
}) }));
vi.mock('@/components/modals/AddChannel.vue', () => state.stub('AddChannel'));
vi.mock('@/components/modals/AddChannelGroup.vue', () => state.stub('AddChannelGroup'));
vi.mock('@/components/modals/ReportDialog.vue', () => state.stub('ReportDialog'));
vi.mock('@/components/shared/EmptyStateArt.vue', () => state.stub('EmptyStateArt'));
vi.mock('@/store/auth/meStore', () => ({ useMe: () => ({ me: { userId: 'me' } }) }));
vi.mock('@/store/data/ultimaStore', () => ({ useUltimaStore: () => ({ unassignedBoosts: [] }) }));
vi.mock('@argon/ui/toast', () => ({ useToast: () => ({ toast() {} }) }));
vi.mock('@/lib/useConfetti', () => ({ default: () => {} }));
vi.mock('@/store/system/fileStorage', () => ({ cdnUrl: () => '' }));
vi.mock('@/composables/useLiveQuery', () => ({ useLiveQuery: () => state.ref({ name: 'Test Space', hideBoostStrip: true }) }));
vi.mock('@/components/modals/BoostShopModal.vue', () => state.stub('BoostShopModal'));
vi.mock('@/components/shared/SpaceBadges.vue', () => state.stub('SpaceBadges'));
vi.mock('@/store/media/unifiedCallStore', () => ({ useUnifiedCall: () => ({ connectedVoiceChannelId: 'voice', setVolume: state.setVolume }) }));
vi.mock('@/store/system/systemStore', () => ({ useSystemStore: () => ({ headphoneMuted: false }) }));
vi.mock('@/store/data/friendsStore', () => ({ useFriendsStore: () => ({ ensureLoaded: async () => {}, isBlocked: () => false }) }));
vi.mock('@/composables/useProfileStatus', () => ({ useProfileStatus: () => state.ref(null) }));
vi.mock('@/composables/useWornProfile', () => ({ useWornProfile: () => state.ref(null) }));
vi.mock('@/composables/useCosmeticFit', () => ({ useCosmeticOverhang: () => state.ref(0) }));
vi.mock('@/composables/useCosmeticsDrawnOn', () => ({ useCosmeticsDrawnOn: () => state.ref(false) }));
vi.mock('@/components/popovers/UserProfilePopover.vue', () => state.stub('UserProfilePopover'));
vi.mock('@/components/ArgonAvatar.vue', () => state.stub('ArgonAvatar'));
vi.mock('@/components/StatusDot.vue', () => state.stub('StatusDot'));
vi.mock('@/components/expressions/StatusEmoji.vue', () => state.stub('StatusEmoji'));
vi.mock('@/cosmetics/CosmeticNickname.vue', async () => {
  const { h } = await import('vue');
  return { default: { setup: (_: unknown, { slots }: any) => () => h('span', slots.default?.()) } };
});

import SpaceContextMenu from '@/components/SpaceContextMenu.vue';
import InventoryView from '@/components/home/views/InventoryView.vue';
import SidebarHeader from '@/components/SidebarHeader.vue';
import UserInListSideElement from '@/components/UserInListSideElement.vue';
import { UserFlag, UserStatus } from '@argon/glue';

const mounted: VueWrapper[] = [];
function render(component: any, props: any, slots: any = {}) {
  const w = mount(component, { props, slots, attachTo: document.body });
  mounted.push(w);
  return w;
}
beforeEach(async () => {
  state.grants.clear(); state.push.mockClear(); state.settings.mockClear(); state.pin.mockClear();
  state.setVolume.mockClear();
  await page.viewport(1280, 900);
});

test('a bot in the connected voice channel has the same working volume slider as a member', async () => {
  const w = render(UserInListSideElement, { user: { userId: 'bot', displayName: 'Music Bot', flags: UserFlag.BOT, status: UserStatus.Online } });
  await userEvent.click(w.find('.user-element').element, { button: 'right' });
  await vi.waitFor(() => expect(document.querySelector('[role=slider]')).not.toBeNull());
  const thumb = document.querySelector<HTMLElement>('[role=slider]')!;
  thumb.focus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(state.setVolume).toHaveBeenCalledWith('bot', 99);
  expect(document.querySelector('[role=menu]')?.textContent).not.toContain('block_user');
});

test('a member context menu can open a direct conversation', async () => {
  const w = render(UserInListSideElement, { user: { userId: 'member', displayName: 'Member', flags: 0, status: UserStatus.Online } });
  await userEvent.click(w.find('.user-element').element, { button: 'right' });
  await vi.waitFor(() => expect(document.querySelector('[role=menu]')).not.toBeNull());
  const message = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((item) => item.textContent?.trim() === 'send_message')!;
  await userEvent.click(message);
  expect(state.push).toHaveBeenCalledWith({ name: 'HomeChat', params: { userId: 'member' } });
});
afterEach(async () => {
  mounted.splice(0).forEach((w) => w.unmount());
  await flushPromises();
  document.body.innerHTML = '';
});

describe('space context menus', () => {
  test('Manage Space opens the clicked space even when another space is selected', async () => {
    state.grants.set('other-space', new Set(['ManageServer', 'ManageChannels']));
    const w = render(SpaceContextMenu, { spaceId: 'other-space' }, { default: '<button>Other Space</button>' });
    await userEvent.click(w.find('button').element, { button: 'right' });
    await vi.waitFor(() => expect(document.querySelector('[role=menu]')).not.toBeNull());
    const items = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')];
    expect(items.map((el) => el.textContent?.trim())).toEqual(expect.arrayContaining(['manage_space', 'add_channel', 'add_category_channels', 'pin', 'mute_space', 'copy_space_id', 'report_space']));
    await userEvent.click(items.find((el) => el.textContent === 'manage_space')!);
    expect(state.push).toHaveBeenCalledWith({ name: 'SpaceShellView', params: { id: 'other-space' } });
    expect(state.settings).toHaveBeenCalledTimes(1);
  });

  test('a member without management rights sees personal actions; the menu stays inside the viewport', async () => {
    const w = render(SpaceContextMenu, { spaceId: 'member-space' }, { default: '<button style="position:fixed;right:4px;bottom:4px">Space</button>' });
    await userEvent.click(w.find('button').element, { button: 'right' });
    await vi.waitFor(() => expect(document.querySelector('[role=menu]')).not.toBeNull());
    const menu = document.querySelector<HTMLElement>('[role=menu]')!;
    expect(menu.textContent).not.toContain('manage_space');
    expect(menu.textContent).not.toContain('add_channel');
    const box = menu.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(innerHeight);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.querySelector('[role=menu]')).toBeNull());
  });
});

test('redeem accepts the checkmark and Enter, trims the code, and ignores blank input', async () => {
  const w = render(InventoryView, { slots: 0 });
  const input = w.find('input');
  const button = w.find('button[type=submit]');
  expect(button.attributes('disabled')).toBeDefined();
  await input.setValue('  CODE-1  ');
  await userEvent.click(button.element);
  expect(w.emitted('redeem')).toEqual([['CODE-1']]);
  await input.setValue('CODE-2');
  await userEvent.click(input.element);
  await userEvent.keyboard('{Enter}');
  expect(w.emitted('redeem')).toEqual([['CODE-1'], ['CODE-2']]);
});

test('space header actions are visible and clickable before hover', async () => {
  state.grants.set('current-space', new Set(['ManageServer', 'ManageChannels']));
  const w = render(SidebarHeader, { selectedSpace: 'current-space' });
  w.element.style.cssText = 'position:fixed;left:40px;top:40px;width:288px';
  const button = w.find('[data-testid=admin-add-channel]').element as HTMLElement;
  const box = button.getBoundingClientRect();
  expect(getComputedStyle(button.parentElement!.parentElement!).opacity).toBe('1');
  expect(button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))).toBe(true);
  await userEvent.click(button);
  expect(w.findComponent({ name: 'AddChannel' }).props('open')).toBe(true);
});
