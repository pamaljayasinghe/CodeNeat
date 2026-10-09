import { useState } from 'react';
import { CATALOG, SECTIONS } from '../../../src/shared/catalog';
import { makeProfileId } from '../../../src/shared/profiles';
import { unsupportedProfileOptions } from '../../../src/shared/resolve';
import type { OptionValue, ProfileDefinition, SettingsDraft, StyleOptions } from '../../../src/shared/types';
import { Badge, Banner, Button, Card, Toggle } from '../components/controls';
import { OptionControl } from '../components/OptionRow';
import type { PageContext } from '../context';
import { host } from '../host';
import { profilesOf, setDefaultProfile, setLanguageProfile } from '../state';

function putProfile(draft: SettingsDraft, profile: ProfileDefinition): SettingsDraft {
  const stored: ProfileDefinition = { id: profile.id, name: profile.name, style: profile.style };
  if (profile.description) {
    stored.description = profile.description;
  }
  if (profile.languages && Object.keys(profile.languages).length > 0) {
    stored.languages = profile.languages;
  }
  return { ...draft, profiles: { ...draft.profiles, [profile.id]: stored } };
}

/** Deletes a custom profile and every reference to it, so nothing points at a missing profile. */
function removeProfile(draft: SettingsDraft, id: string): SettingsDraft {
  const profiles = { ...draft.profiles };
  delete profiles[id];
  let next: SettingsDraft = { ...draft, profiles };
  for (const scope of ['user', 'workspace'] as const) {
    if (next[scope].defaultProfile === id) {
      next = setDefaultProfile(next, scope, undefined);
    }
    for (const [languageId, entry] of Object.entries(next[scope].languages)) {
      if (entry.profile === id) {
        next = setLanguageProfile(next, scope, languageId, undefined);
      }
    }
  }
  return next;
}

export function addImportedProfile(draft: SettingsDraft, imported: ProfileDefinition): SettingsDraft {
  const id = makeProfileId(imported.name, Object.keys(draft.profiles));
  return putProfile(draft, { ...imported, id, builtin: false });
}

interface EditorProps {
  context: PageContext;
  profile: ProfileDefinition;
  onClose(): void;
}

function ProfileEditor({ context, profile, onClose }: EditorProps) {
  const { view, languageId } = context;
  const [forLanguage, setForLanguage] = useState(false);
  const languageLabel = view?.language.label ?? languageId;
  const others = profilesOf(context.state, context.draft).filter((candidate) => candidate.id !== profile.id);
  const nameTaken = others.some((candidate) => candidate.name.trim().toLowerCase() === profile.name.trim().toLowerCase());
  const nameError = !profile.name.trim() ? 'Give the profile a name.' : nameTaken ? 'Another profile already has this name.' : undefined;

  const save = (next: ProfileDefinition): void => context.update((draft) => putProfile(draft, next));
  const values: StyleOptions = forLanguage ? (profile.languages?.[languageId] ?? {}) : profile.style;
  const setValue = (id: string, value: OptionValue | undefined): void => {
    const nextValues = { ...values };
    if (value === undefined) {
      delete nextValues[id];
    } else {
      nextValues[id] = value;
    }
    if (forLanguage) {
      const languages = { ...(profile.languages ?? {}) };
      if (Object.keys(nextValues).length === 0) {
        delete languages[languageId];
      } else {
        languages[languageId] = nextValues;
      }
      save({ ...profile, languages });
    } else {
      save({ ...profile, style: nextValues });
    }
  };

  return (
    <Card
      title={`Edit profile: ${profile.name || 'Untitled'}`}
      actions={
        <Button kind="primary" onClick={onClose} disabled={!!nameError}>
          Done
        </Button>
      }
    >
      <div className="form-grid">
        <label htmlFor="profile-name">Name</label>
        <div>
          <input
            id="profile-name"
            type="text"
            className={`text-input${nameError ? ' has-error' : ''}`}
            value={profile.name}
            maxLength={80}
            aria-invalid={!!nameError}
            onChange={(event) => save({ ...profile, name: event.target.value })}
          />
          {nameError && (
            <p className="field-error" role="alert">
              {nameError}
            </p>
          )}
        </div>
        <label htmlFor="profile-description">Description</label>
        <input
          id="profile-description"
          type="text"
          className="text-input"
          value={profile.description ?? ''}
          maxLength={400}
          placeholder="What is this profile for?"
          onChange={(event) => save({ ...profile, description: event.target.value })}
        />
      </div>
      <div className="segmented" role="group" aria-label="Which values to edit">
        <button type="button" className={!forLanguage ? 'is-selected' : ''} aria-pressed={!forLanguage} onClick={() => setForLanguage(false)}>
          Values for all languages
        </button>
        <button type="button" className={forLanguage ? 'is-selected' : ''} aria-pressed={forLanguage} disabled={!view} onClick={() => setForLanguage(true)}>
          Extra values only for {languageLabel}
        </button>
      </div>
      <p className="muted">
        Switch an option on to make it part of the profile. Options that are off keep the formatter’s own default. A formatter simply skips options it
        does not support.
      </p>
      {SECTIONS.map((section) => (
        <details key={section.id} className="option-group" open={section.id === 'wrapping' || section.id === 'indentation'}>
          <summary>
            {section.title}{' '}
            <span className="muted">
              ({CATALOG.filter((option) => option.section === section.id && values[option.id] !== undefined).length} set)
            </span>
          </summary>
          {CATALOG.filter((option) => option.section === section.id).map((definition) => {
            const included = values[definition.id] !== undefined;
            const value = values[definition.id] ?? definition.codeneatDefault ?? definition.fallback;
            return (
              <div key={definition.id} className={`option-row${included ? '' : ' is-muted'}`}>
                <div className="option-text">
                  <span className="option-label">{definition.label}</span>
                  <p className="option-description">{definition.description}</p>
                </div>
                <div className="option-control">
                  <div className="include-row">
                    <span className="muted">In profile</span>
                    <Toggle
                      label={`Include ${definition.label} in the profile`}
                      checked={included}
                      onChange={(on) => setValue(definition.id, on ? value : undefined)}
                    />
                  </div>
                  {included && <OptionControl definition={definition} value={value} onChange={(next) => setValue(definition.id, next)} />}
                </div>
              </div>
            );
          })}
        </details>
      ))}
    </Card>
  );
}

export function ProfilesPage({ context }: { context: PageContext }) {
  const { state, draft, scope, view, languageId } = context;
  const [editing, setEditing] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const profiles = profilesOf(state, draft);
  const userDefault = draft.user.defaultProfile ?? 'standard';
  const workspaceDefault = draft.workspace.defaultProfile;
  const languageProfile = draft.workspace.languages[languageId]?.profile ?? draft.user.languages[languageId]?.profile;
  const scopeName = scope === 'user' ? 'my default' : 'the workspace default';
  const editingProfile = editing ? profiles.find((profile) => profile.id === editing && !profile.builtin) : undefined;

  const create = (base: Partial<ProfileDefinition>, name: string): void => {
    const id = makeProfileId(name, Object.keys(draft.profiles));
    let uniqueName = name;
    let counter = 2;
    while (profiles.some((profile) => profile.name === uniqueName)) {
      uniqueName = `${name} ${counter++}`;
    }
    context.update((current) => putProfile(current, { id, name: uniqueName, description: base.description, style: { ...(base.style ?? {}) }, languages: base.languages }));
    setEditing(id);
  };

  const fromCurrent = (): void => {
    const style: StyleOptions = {};
    if (view?.resolved) {
      for (const id of view.resolved.explicit) {
        style[id] = view.resolved.values[id];
      }
    }
    create({ style, description: view ? `Created from the settings in effect for ${view.language.label}.` : undefined }, 'My Style');
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Formatting Profiles</h2>
        <p>A profile is a named set of preferences. Switch between them, or give a language or a workspace its own.</p>
      </header>

      <div className="button-row">
        <Button kind="primary" onClick={() => create({ style: { lineLength: 120 } }, 'New Profile')}>
          New Profile
        </Button>
        <Button onClick={fromCurrent} disabled={!view?.resolved} title="Start a profile from the settings currently in effect for the selected language">
          New From Current Settings
        </Button>
        <Button onClick={() => host.post({ type: 'importProfile' })}>Import Profile…</Button>
      </div>

      {editingProfile && <ProfileEditor context={context} profile={editingProfile} onClose={() => setEditing(undefined)} />}

      <div className="profile-list">
        {profiles.map((profile) => {
          const count = Object.keys(profile.style).length;
          const languageCount = Object.keys(profile.languages ?? {}).length;
          const issues = view?.formatter ? unsupportedProfileOptions(profile, view.formatter, languageId) : [];
          const isScopeDefault = scope === 'user' ? userDefault === profile.id : workspaceDefault === profile.id;
          return (
            <Card
              key={profile.id}
              title={profile.name}
              actions={
                <>
                  {profile.builtin ? <Badge>Built-in</Badge> : <Badge tone="info">Custom</Badge>}
                  {userDefault === profile.id && <Badge tone="ok">My default</Badge>}
                  {workspaceDefault === profile.id && <Badge tone="ok">Workspace default</Badge>}
                  {languageProfile === profile.id && view && <Badge tone="ok">Used for {view.language.label}</Badge>}
                </>
              }
            >
              <p>{profile.description || 'No description.'}</p>
              <p className="muted">
                {count} {count === 1 ? 'option' : 'options'} set
                {languageCount > 0 ? `, plus extra values for ${languageCount} ${languageCount === 1 ? 'language' : 'languages'}` : ''}.
              </p>
              {issues.length > 0 && view?.formatter && (
                <details className="profile-issues">
                  <summary>
                    {issues.length} {issues.length === 1 ? 'option' : 'options'} in this profile cannot be applied to {view.language.label} ({view.formatter.displayName})
                  </summary>
                  <ul>
                    {issues.map((issue) => (
                      <li key={issue.id}>
                        <strong>{issue.label}:</strong> {issue.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="button-row">
                <Button
                  small
                  kind={isScopeDefault ? 'secondary' : 'primary'}
                  disabled={isScopeDefault || (scope === 'workspace' && !state.hasWorkspace)}
                  onClick={() => context.update((current) => setDefaultProfile(current, scope, profile.id))}
                >
                  {isScopeDefault ? `Is ${scopeName}` : `Set as ${scopeName}`}
                </Button>
                {view && (
                  <Button
                    small
                    disabled={draft[scope].languages[languageId]?.profile === profile.id}
                    onClick={() => context.update((current) => setLanguageProfile(current, scope, languageId, profile.id))}
                  >
                    Use for {view.language.label}
                  </Button>
                )}
                <Button small onClick={() => create({ style: profile.style, languages: profile.languages, description: profile.description }, `${profile.name} Copy`)}>
                  Duplicate
                </Button>
                {!profile.builtin && (
                  <Button small onClick={() => setEditing(profile.id)}>
                    Edit / Rename
                  </Button>
                )}
                <Button small onClick={() => host.post({ type: 'exportProfile', profile })}>
                  Export…
                </Button>
                {!profile.builtin &&
                  (confirmDelete === profile.id ? (
                    <>
                      <Button
                        small
                        kind="danger"
                        onClick={() => {
                          context.update((current) => removeProfile(current, profile.id));
                          setConfirmDelete(undefined);
                          if (editing === profile.id) {
                            setEditing(undefined);
                          }
                        }}
                      >
                        Really delete
                      </Button>
                      <Button small kind="ghost" onClick={() => setConfirmDelete(undefined)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button small kind="ghost" onClick={() => setConfirmDelete(profile.id)}>
                      Delete
                    </Button>
                  ))}
              </div>
            </Card>
          );
        })}
      </div>
      {view && draft[scope].languages[languageId]?.profile && (
        <Banner>
          {view.language.label} uses its own profile.{' '}
          <Button small kind="ghost" onClick={() => context.update((current) => setLanguageProfile(current, scope, languageId, undefined))}>
            Go back to the default profile for {view.language.label}
          </Button>
        </Banner>
      )}
      <p className="muted">Built-in profiles cannot be changed; duplicate one to make your own. Custom profiles are saved in your settings when you press Apply.</p>
    </div>
  );
}
