import { describe, expect, it } from 'vitest';
import {
  isAssessmentTypeCompatibleWithAsset,
  canTransitionAssessmentStatus,
  canTransitionAssessmentJobStatus,
} from './assessments.js';
import { ASSET_TYPES, isAssetType } from './assets.js';

describe('isAssessmentTypeCompatibleWithAsset', () => {
  it('allows WEB and API assessments on a WEB asset', () => {
    expect(isAssessmentTypeCompatibleWithAsset('WEB', 'WEB')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('WEB', 'API')).toBe(true);
  });

  it('rejects a WEB assessment on an ANDROID asset', () => {
    expect(isAssessmentTypeCompatibleWithAsset('ANDROID', 'WEB')).toBe(false);
  });

  it('allows ANDROID_STATIC/ANDROID_DYNAMIC/API on an ANDROID asset', () => {
    expect(isAssessmentTypeCompatibleWithAsset('ANDROID', 'ANDROID_STATIC')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('ANDROID', 'ANDROID_DYNAMIC')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('ANDROID', 'API')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('ANDROID', 'IOS_STATIC')).toBe(false);
  });

  it('allows IOS_STATIC/IOS_DYNAMIC/API on an IOS asset, nothing else', () => {
    expect(isAssessmentTypeCompatibleWithAsset('IOS', 'IOS_STATIC')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('IOS', 'IOS_DYNAMIC')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('IOS', 'API')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('IOS', 'ANDROID_STATIC')).toBe(false);
  });

  it('an API asset only ever accepts an API assessment', () => {
    expect(isAssessmentTypeCompatibleWithAsset('API', 'API')).toBe(true);
    expect(isAssessmentTypeCompatibleWithAsset('API', 'WEB')).toBe(false);
  });

  it('every asset type has at least one compatible assessment type', () => {
    for (const assetType of ASSET_TYPES) {
      expect(isAssetType(assetType)).toBe(true);
    }
  });
});

describe('canTransitionAssessmentStatus', () => {
  it('allows QUEUED -> RUNNING -> COMPLETED', () => {
    expect(canTransitionAssessmentStatus('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransitionAssessmentStatus('RUNNING', 'COMPLETED')).toBe(true);
  });

  it('allows QUEUED -> CANCELLED directly', () => {
    expect(canTransitionAssessmentStatus('QUEUED', 'CANCELLED')).toBe(true);
  });

  it('rejects transitions out of terminal states', () => {
    expect(canTransitionAssessmentStatus('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransitionAssessmentStatus('FAILED', 'QUEUED')).toBe(false);
    expect(canTransitionAssessmentStatus('CANCELLED', 'RUNNING')).toBe(false);
  });

  it('rejects skipping backwards from RUNNING to QUEUED', () => {
    expect(canTransitionAssessmentStatus('RUNNING', 'QUEUED')).toBe(false);
  });
});

describe('canTransitionAssessmentJobStatus', () => {
  it('mirrors the assessment status lifecycle', () => {
    expect(canTransitionAssessmentJobStatus('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransitionAssessmentJobStatus('COMPLETED', 'QUEUED')).toBe(false);
  });
});
