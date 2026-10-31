/**
 * Экран входа и сессия.
 *
 * Токен живёт в sessionStorage: закрыл вкладку — вход заново, но обновление
 * страницы не выкидывает. Хранить в localStorage дольше было бы удобнее,
 * но на общих ноутбуках это утечка чужого входа.
 */

export interface Session {
  token: string;
  playerId: number;
  name: string;
}

const TOKEN_KEY = 'bks5.token';

export async function ensureSession(): Promise<Session> {
  const saved = sessionStorage.getItem(TOKEN_KEY);

  if (saved) {
    try {
      const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${saved}` } });
      if (response.ok) {
        const data = (await response.json()) as { playerId: number; name: string };
        return { token: saved, playerId: data.playerId, name: data.name };
      }
    } catch {
      // сервер недоступен — не страшно, покажем экран входа
    }
    sessionStorage.removeItem(TOKEN_KEY);
  }

  return promptLogin();
}

export function forgetSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

function promptLogin(): Promise<Session> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('login') as HTMLElement;
    const form = document.getElementById('login-form') as HTMLFormElement;
    const loginInput = document.getElementById('login-name') as HTMLInputElement;
    const passInput = document.getElementById('login-pass') as HTMLInputElement;
    const errorBox = document.getElementById('login-error') as HTMLElement;
    const submit = document.getElementById('login-submit') as HTMLButtonElement;

    overlay.classList.remove('hidden');
    loginInput.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.textContent = '';
      submit.disabled = true;

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: loginInput.value.trim(), password: passInput.value }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          token?: string;
          playerId?: number;
          name?: string;
          error?: { message?: string };
        };

        if (!response.ok || !data.token) {
          errorBox.textContent = data.error?.message ?? 'не удалось войти';
          return;
        }

        sessionStorage.setItem(TOKEN_KEY, data.token);
        overlay.classList.add('hidden');
        resolve({ token: data.token, playerId: data.playerId ?? 0, name: data.name ?? '' });
      } catch {
        errorBox.textContent = 'сервер не отвечает';
      } finally {
        submit.disabled = false;
      }
    });
  });
}
