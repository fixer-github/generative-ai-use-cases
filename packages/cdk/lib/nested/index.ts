/**
 * Nested Stacks (root-cause fix for the CloudFormation 500-resources-per-stack limit).
 * Parent doc: the Phase 2 "stack split / NestedStack migration" plan memo under the
 * project's UIUX docs (see Phase2_*_NestedStack*_*.md).
 *
 * ## Purpose
 * The single-stack x single-RestApi design hit the 500-resource limit. Each feature
 * domain is moved into its own child NestedStack, carrying its construct wholesale
 * (Resource + Method + Lambda + IAM + Authorizer + any Table/Bucket it owns). From the
 * parent, a child is a single `AWS::CloudFormation::Stack` resource and each child gets
 * its own 500-resource budget. The RestApi itself stays in the parent, so the frontend
 * API endpoint is unchanged (no VITE_APP_API_ENDPOINT change).
 *
 * ## Convention (when adding a new child NestedStack)
 * - One domain = one file: `<domain>-nested-stack.ts`
 * - Class: `<Domain>NestedStack extends cdk.NestedStack`
 * - Props: `<Domain>NestedStackProps extends NestedStackProps`. List the cross-stack
 *   inputs passed parent -> child (userPool / api(RestApi) / idPool / vpc / securityGroups).
 *   Never reverse-reference a specific parent resource from the child; references must be
 *   one-directional child -> parent (NestedStack parameterizes them automatically).
 * - Inside, just instantiate the existing construct: `new XxxApi(this, 'XxxApi', {...})`.
 *   But rewrite the construct's API Gateway attach point (its first addResource on the
 *   RestApi root) to the "explicit parent form" (C3 below).
 *
 * ## Gotchas hit when moving a construct (maps to memo §4 + the §4.4 addendum below)
 * - C1: a Resource/Method created via `api.root.addResource(x)` is scoped to "the stack
 *   that holds the RestApi" (= parent), not to where the call is written. Merely wrapping
 *   the construct in a NestedStack leaves the routes in the parent.
 * - C3: to place a Resource in the child, scope it to the child construct (`this`) while
 *   naming the API Gateway parent explicitly:
 *     `new apigateway.Resource(this, 'admin', { parent: api.root, pathPart: 'admin' })`
 *   Descendant addResource/addMethod calls then chain off the child scope and land in the
 *   child automatically. defaultCorsPreflightOptions / defaultMethodOptions / Deployment
 *   logical-id hashing are all inherited from props.parent(=api.root), so the external
 *   shape (CORS, authorizer, paths) is unchanged.
 * - C2: splitting a feature (Method in parent, Lambda in child) creates a parent<->child
 *   cycle and synth fails. Move the whole feature into one child.
 * - C4 (addendum, verified at synth — supersedes the memo's "NestedStack never cycles"):
 *   the parent's auto Deployment must be created after the child's Methods, so the parent
 *   adds `api.api.latestDeployment?.node.addDependency(<childStack>)` (Deployment -> child).
 *   BUT the child's Lambda permissions, by default, reference `method.methodArn` which
 *   embeds the parent's deployment Stage (child -> Stage), and Stage -> Deployment. Because
 *   a NestedStack collapses all child resources into one node, this becomes the cycle
 *   Deployment -> child -> Stage -> Deployment. Break it by giving every LambdaIntegration
 *   in the child `{ scopePermissionToMethod: false }`: the permission then uses
 *   `api.arnForExecuteApi()` (`${restApiId}/*`, no Stage reference), removing the child ->
 *   Stage edge. (Bonus: one api-scoped permission per Lambda instead of per method.)
 * - C5: two Resources with the same path cannot coexist on one RestApi. Move each domain in
 *   two deploys: deploy A removes the old construct from the parent; deploy B creates the child.
 */
export * from './admin-nested-stack';
export * from './scheduler-nested-stack';
