# 실행과 환경 설정

[프로젝트 소개](../README.md) · [환경변수 예시](../.env.example) · [DB 스키마](../prisma/schema.prisma)

## Docker Compose로 실행

Docker와 Docker Compose를 준비합니다. 앱 이미지는 Node.js 20 기반이며 DB는 PostgreSQL 16입니다.

```bash
git clone https://github.com/ho72/unified-auth-server.git
cd unified-auth-server
cp .env.example .env
```

`.env`를 자신의 로컬 환경에 맞춰 설정합니다.

| 환경변수 | 역할 |
| --- | --- |
| `JWT_SECRET` | 충분히 긴 무작위 서명 키. 사진·파일 공유 연동을 포함한다면 32자 이상 사용 |
| `DATABASE_URL` | DB 연결 문자열. Compose의 DB 호스트명은 `db` |
| `POSTGRES_PASSWORD` | Compose DB의 비밀번호. `DATABASE_URL`의 비밀번호와 일치시킴 |
| `PORT` | 앱 포트. 기본 4000 |
| `UNIPASS_BIND_ADDRESS` | Compose에서 호스트에 공개할 바인딩 주소. 기본 `127.0.0.1` |

```bash
docker compose up --build -d
```

Compose는 DB 상태를 확인한 뒤 앱 컨테이너에서 마이그레이션을 적용합니다. DB와 아바타 파일은 Docker volume에 저장합니다.

- 계정 화면: `http://localhost:4000`
- 상태 확인: `http://localhost:4000/health`

이번 검증은 로컬 Node 프로세스와 임시 PostgreSQL 16의 조합으로 수행했습니다. 앱 Docker 이미지 빌드와 운영 배포는 별도 검증 범위입니다.

## Node 개발 환경

Node.js 22와 npm을 준비하고, 접근 가능한 PostgreSQL DB에 맞춰 `DATABASE_URL`을 설정합니다. 호스트에서 실행하는 Node 프로세스에는 Compose 내부 호스트명 `db` 대신 접근 가능한 DB 주소가 필요합니다. 기본 Compose 설정은 DB 포트를 호스트에 노출하지 않습니다.

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

빌드와 실행은 다음 명령을 사용합니다.

```bash
npm run build
npm start
```

## 소셜 로그인과 전화번호 인증

| 기능 | 설정 |
| --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` |
| Kakao | `KAKAO_CLIENT_ID`, 필요 시 `KAKAO_CLIENT_SECRET`, `KAKAO_CALLBACK_URL`, scope 설정 |
| 전화번호 확인 | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_VERIFY_SERVICE_SID` |

제공자에 등록할 콜백은 이 인증 서버의 `/auth/google/callback`, `/auth/kakao/callback`입니다. 실제 로그인 앱의 허용 주소와 설정해야 합니다.

현재 서비스 이동 흐름은 소셜 로그인으로 얻은 계정의 전화번호 확인 상태를 검사합니다. 확인되지 않은 계정은 인증 서버 화면에서 전화번호 확인을 진행하므로, 해당 흐름을 실행하려면 Twilio 설정도 준비해야 합니다.

DB를 실행하는 것과 외부 로그인·문자 인증을 사용할 수 있는 것은 별개의 조건입니다. 공개 예시에는 실제 제공자 인증정보나 사용자 계정이 포함되어 있지 않습니다.

## 세 서비스 연결

| 서비스 | 인증 서버의 Origin 설정 | 로컬 예시 |
| --- | --- | --- |
| 사진·파일 공유 | `OURI_ORIGIN` | `http://localhost:5174` |
| 스마트홈 관리 | `NOOK_ORIGIN` | `http://localhost:5173` |
| AI 개발 워크스페이스 | `DEVI_ORIGIN` | `http://localhost:4050` |

각 서비스에서 브라우저가 접근하는 주소와 맞춥니다. 위 Origin 설정은 연결 서비스 레지스트리와 이용 기록의 매핑에 사용합니다. 서비스별 로그인 복귀 경로는 다음과 같습니다.

- 사진·파일 공유: `/api/auth/unipass/callback`
- 스마트홈 관리: 웹의 기본 진입 주소에서 토큰 처리
- AI 개발 워크스페이스: `/auth/callback`

인증 서버의 소셜 로그인 콜백 주소와 각 서비스의 로그인 복귀 주소를 구분합니다.

## 주요 API

| API | 역할 |
| --- | --- |
| `GET /health` | 서버 상태 |
| `GET /auth/me` | 토큰에 해당하는 계정 프로필 |
| `POST /auth/refresh` | refresh token 교환·회전 |
| `POST /auth/logout` | refresh token 제거 |
| `GET /auth/google`, `GET /auth/kakao` | 소셜 로그인 시작 |
| `POST /auth/phone/start`, `POST /auth/phone/check` | 전화번호 확인 |
| `GET /auth/me/login-events` | 로그인 기록 조회 |

실제 `.env`, DB volume, 아바타 업로드, 계정·로그인 기록은 공개 코드와 분리해서 관리합니다.
