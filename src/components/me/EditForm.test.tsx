// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditForm } from '@/components/me/EditForm'

const mocks = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  retryBoot: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const me = {
  id: 'member-a',
  phone: '',
  password: '',
  nickname: '测试会员',
  gender: 'female',
  seeking: 'male',
  birthDate: '1990-01-01',
  city: '杭州',
  region: '浙江省·杭州市·西湖区',
  height: 165,
  job: '产品经理',
  bio: '喜欢认真生活，也愿意慢慢认识一个人。',
  interests: ['摄影', '旅行', '电影'],
  photos: [],
  verification: { phone: false, realname: false, photo: false },
  createdAt: 1,
}

vi.mock('@/lib/store-context', () => ({
  useStore: () => ({
    me,
    saveProfile: mocks.saveProfile,
    dataReady: true,
    bootError: '',
    retryBoot: mocks.retryBoot,
  }),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

beforeEach(() => {
  mocks.saveProfile.mockReset()
  mocks.retryBoot.mockReset()
  mocks.toast.mockClear()
  mocks.toast.success.mockClear()
  mocks.toast.error.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('EditForm 草稿可靠性', () => {
  it('识别未保存修改，离开会提醒，并可一键恢复已保存资料', () => {
    render(
      <>
        <EditForm />
        <a href="/events">去活动</a>
      </>,
    )

    const nickname = screen.getByDisplayValue('测试会员')
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()

    fireEvent.change(nickname, { target: { value: '新的昵称' } })
    expect(screen.getByText('有未保存修改')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存资料' })).toBeEnabled()

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('link', { name: '去活动' }))
    expect(confirm).toHaveBeenCalledWith('资料还有未保存修改，确定要离开吗？')

    fireEvent.click(screen.getByRole('button', { name: '取消修改' }))
    expect(nickname).toHaveValue('测试会员')
    expect(screen.getByText('当前资料已保存')).toBeInTheDocument()
  })

  it('润色先给预览，不直接覆盖原文；用户采用后才进入草稿', () => {
    render(<EditForm />)
    const bio = screen.getByDisplayValue(me.bio)

    fireEvent.click(screen.getByRole('button', { name: '润色预览' }))
    expect(bio).toHaveValue(me.bio)
    expect(screen.getByText(/只基于你已经填写的内容调整表达/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '采用这版' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '采用这版' }))
    expect(bio).not.toHaveValue(me.bio)
    expect(screen.getByText('有未保存修改')).toBeInTheDocument()
  })

  it('允许只确认必要资料并不选择兴趣，兴趣不会阻断首次进入推荐', async () => {
    mocks.saveProfile.mockResolvedValue(undefined)
    render(<EditForm />)
    for (const tag of me.interests) fireEvent.click(screen.getByRole('button', { name: tag }))
    fireEvent.change(screen.getByDisplayValue('测试会员'), { target: { value: '首次入门会员' } })
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
    await waitFor(() => expect(mocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ interests: [] })))
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('保存失败保留当前草稿，成功请求只发送本人确认后的字段', async () => {
    mocks.saveProfile.mockRejectedValueOnce(new Error('network failed'))
    render(<EditForm />)
    const nickname = screen.getByDisplayValue('测试会员')

    fireEvent.change(nickname, { target: { value: '保存中的昵称' } })
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }))

    await waitFor(() => expect(mocks.saveProfile).toHaveBeenCalledTimes(1))
    expect(mocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      nickname: '保存中的昵称',
      gender: 'female',
      seeking: 'male',
      birthDate: '1990-01-01',
      city: '杭州',
      job: '产品经理',
      bio: me.bio,
      interests: me.interests,
    }))
    expect(nickname).toHaveValue('保存中的昵称')
    expect(screen.getByText('有未保存修改')).toBeInTheDocument()
  })
})
