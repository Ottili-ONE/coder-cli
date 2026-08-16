import { Effect, Option } from "effect"
import { AccountRepo } from "./repo"
import { AccessToken, AccountID, OrgID, RefreshToken } from "./schema"
import { ottiliOneServiceUrl, type OttiliOneLoginResult } from "./ottili-one"

export const persistOttiliOneLogin = Effect.fn("Account.persistOttiliOneLogin")(function* (
  result: OttiliOneLoginResult,
) {
  const repo = yield* AccountRepo.Service
  const orgID = result.org ? Option.some(OrgID.make(result.org.id)) : Option.none<OrgID>()

  yield* repo.persistAccount({
    id: AccountID.make(String(result.user.user_id)),
    email: result.user.email ?? result.user.username,
    url: ottiliOneServiceUrl(result.authUrl),
    accessToken: AccessToken.make(result.accessToken),
    refreshToken: RefreshToken.make(result.refreshToken),
    expiry: result.expiresAt,
    orgID,
  })

  return result.user.email ?? result.user.username
})
