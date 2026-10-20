<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<@layout.registrationLayout displayMessage=true; section>
<!-- template: fullstar-email.ftl -->
    <#if section="header">
        ${msg("fullstarEmailTitle")}
    <#elseif section="form">
        <p>${msg("fullstarEmailIntro")}</p>
        <form id="kc-fullstar-email-form" class="${properties.kcFormClass!}" onsubmit="send.disabled = true; return true;" action="${url.loginAction}" method="post">
            <@field.input name="email" label=msg("email") autocomplete="email" autofocus=true />
            <@buttons.actionGroup>
                <@buttons.button id="kc-send-code" name="send" label="fullstarSendCode" />
            </@buttons.actionGroup>
        </form>
    </#if>
</@layout.registrationLayout>
