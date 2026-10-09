import { describe, expect, it } from 'vitest'
import { evaluateReleaseReadiness } from './release-preflight.mjs'

function facts(overrides = {}) {
  return {
    sourceComplete: true, bundleReady: true, gitDiffClean: true,
    gitConflicts: false, gitClean: true, secretIgnored: true, trackedSensitiveFiles: false,
    composeValid: true, dockerEngine: true, productionDsnConfigured: true,
    persistentUploadsConfigured: true, freshBackup: true, ...overrides,
  }
}

describe('生产发布只读预检', () => {
  it('前置条件全部通过才给 deploymentReady', () => {
    const result = evaluateReleaseReadiness(facts())
    expect(result.sourceReady).toBe(true)
    expect(result.deploymentReady).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('开发工作区未提交或 Docker 不可用时阻止生产发布，但源代码仍可就绪', () => {
    const result = evaluateReleaseReadiness(facts({ gitClean: false, dockerEngine: false }))
    expect(result.sourceReady).toBe(true)
    expect(result.deploymentReady).toBe(false)
    expect(result.blockers).toEqual(['git-clean', 'docker-engine'])
  })

  it('缺失被忽略的密钥规则或者发现已跟踪的私密文件时阻止发布', () => {
    const result = evaluateReleaseReadiness(facts({ secretIgnored: false, trackedSensitiveFiles: true }))
    expect(result.sourceReady).toBe(false)
    expect(result.deploymentReady).toBe(false)
    expect(result.blockers).toContain('secret-ignore')
  })

  it('没有数据库/附件同周期备份和绝对路径上传目录时阻止正式上线', () => {
    const result = evaluateReleaseReadiness(facts({ freshBackup: false, persistentUploadsConfigured: false, productionDsnConfigured: false }))
    expect(result.blockers).toEqual(['database-secret', 'persistent-uploads', 'fresh-backup'])
  })

  it('React 构建缺失或 Compose 失效不能把源码标记为就绪', () => {
    const result = evaluateReleaseReadiness(facts({ bundleReady: false, composeValid: false }))
    expect(result.sourceReady).toBe(false)
    expect(result.blockers).toContain('bundle')
    expect(result.blockers).toContain('compose')
  })
})
